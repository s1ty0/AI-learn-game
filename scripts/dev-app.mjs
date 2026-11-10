import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createConnection } from "node:net";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, ".runtime");
const webPort=Number(process.env.LEARN_WEB_PORT??3000),apiPort=Number(process.env.LEARN_API_PORT??8000);
if(![webPort,apiPort].every(p=>Number.isInteger(p)&&p>=1024&&p<=65535)||webPort===apiPort)throw new Error("Web/API端口必须不同，且在1024至65535之间。");
const database=process.env.LEARN_LOCAL_DATABASE??"learnai";
if(!/^learnai(?:_[a-z0-9_]{1,45})?$/.test(database))throw new Error("本机数据库名须为learnai或learnai_开头的测试名称。");
await mkdir(runtime, { recursive: true });
const secretPath = path.join(runtime, "db-secret.json");
let secret;
try { secret = JSON.parse(await readFile(secretPath, "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  secret = { password: randomBytes(24).toString("hex") };
  await writeFile(secretPath, JSON.stringify(secret), { mode: 0o600, flag: "wx" });
}
const rootRequire = createRequire(import.meta.url);
const binaryRequire = createRequire(rootRequire.resolve("embedded-postgres"));
const binaryEntry = binaryRequire.resolve(process.platform === "win32" ? "@embedded-postgres/windows-x64" : "@embedded-postgres/linux-x64");
const { pg_ctl } = await import(new URL(`file:///${binaryEntry.replaceAll("\\", "/")}`));
const dataDir = path.join(runtime, "postgres");
let startedDatabase = false;
const children = [];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) {
    if (process.platform === "win32" && child.pid) {
      await once("taskkill", ["/pid", String(child.pid), "/t", "/f"]).catch(() => {});
    } else child.kill("SIGTERM");
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  if (startedDatabase) await once(pg_ctl, ["-D", dataDir, "-m", "fast", "-w", "stop"]).catch(() => {});
}
process.on("SIGINT", () => stop().then(() => process.exit(0)));
process.on("SIGTERM", () => stop().then(() => process.exit(0)));

function launch(command, args, options = {}) {
  return spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true, ...options });
}
async function once(command, args, options = {}) {
  const child = launch(command, args, options);
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Process failed with code ${code}`)));
  });
}

function service(name, command, args, options) {
  // Retained tool sessions may stop draining their pipes. Service logs use files
  // so API request handling never depends on an attached terminal reading output.
  const log = openSync(path.join(runtime, `${name}.log`), "a");
  try { return launch(command, args, { ...options, stdio: ["ignore", log, log] }); }
  finally { closeSync(log); }
}

async function ready(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`服务未就绪：${url}，请查看 .runtime/api.log 与 .runtime/web.log`);
}

async function portInUse(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let finished = false;
    function done(value) { if (!finished) { finished = true; socket.destroy(); resolve(value); } }
    socket.once("connect", () => done(true)); socket.once("error", () => done(false));
    socket.setTimeout(400, () => done(false));
  });
}

try {
  if (!process.argv.includes("--test-api")) {
    const ports = process.argv.includes("--api-only") ? [apiPort] : [apiPort,webPort];
    for (const port of ports) {
      if (await portInUse(port)) throw new Error(`本机${port}端口已有服务，请复用当前预览或先停止旧进程；未修改已有服务。`);
    }
  }
  try { await access(path.join(dataDir, "PG_VERSION")); }
  catch {
    const passwordFile = path.join(runtime, "init-password.tmp");
    await writeFile(passwordFile, secret.password + "\n", { mode: 0o600 });
    try { await once(pg_ctl, ["-D", dataDir, "-o", `--auth=scram-sha-256 --username=learnai --pwfile="${passwordFile}"`, "initdb"]); }
    finally { const { unlink } = await import("node:fs/promises"); await unlink(passwordFile); }
  }
  const databaseRunning = await once(pg_ctl, ["-D", dataDir, "status"], { stdio: "ignore" }).then(() => true, () => false);
  if (!databaseRunning) {
    await once(pg_ctl, ["-D", dataDir, "-l", path.join(runtime, "postgres-server.log"), "-o", "-p 54329 -h 127.0.0.1", "-w", "start"]);
    startedDatabase = true;
  }
  const env = { ...process.env, DATABASE_URL: `postgresql+psycopg://learnai:${secret.password}@127.0.0.1:54329/${database}`, NEXT_TELEMETRY_DISABLED: "1", LEARN_LOCAL_DEMO: "1",LEARN_WEB_ORIGIN:`http://127.0.0.1:${webPort}`,LEARN_API_ORIGIN:`http://127.0.0.1:${apiPort}` };
  const python = path.join(root, "apps/api/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const adminEnv = { ...env, DB_ADMIN_URL: `postgresql://learnai:${secret.password}@127.0.0.1:54329/postgres`,LEARN_LOCAL_DATABASE:database };
  await once(python, ["-c", "import os,psycopg; from psycopg import sql; name=os.environ['LEARN_LOCAL_DATABASE']; c=psycopg.connect(os.environ['DB_ADMIN_URL'],autocommit=True); exists=c.execute('SELECT 1 FROM pg_database WHERE datname=%s',(name,)).fetchone(); c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name))) if not exists else None; c.close()"], { env: adminEnv });
  await once(python, ["-m", "alembic", "-c", path.join(root, "apps/api/alembic.ini"), "upgrade", "head"], { cwd: path.join(root, "apps/api"), env });
  if (process.argv.includes("--test-api")) {
    await once(python, ["-m", "pytest", "-q"], { cwd: path.join(root, "apps/api"), env });
    await stop();
  } else {
    children.push(service("api", python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(apiPort)], { cwd: path.join(root, "apps/api"), env }));
    if (!process.argv.includes("--api-only")) {
      const require = createRequire(path.join(root, "apps/web/package.json"));
      children.push(service("web", process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(webPort)], { cwd: path.join(root, "apps/web"), env }));
    }
    for (const child of children) child.on("exit", code => { if (!stopping) { console.error(`服务退出 (${code})`); stop().then(() => process.exit(1)); } });
    await ready(`http://127.0.0.1:${apiPort}/api/v1/health`);
    if (!process.argv.includes("--api-only")) await ready(`http://127.0.0.1:${webPort}`);
    console.log(process.argv.includes("--api-only") ? `LearnAI API已就绪：http://127.0.0.1:${apiPort} · 日志：.runtime/api.log` : `LearnAI 本地预览已就绪：http://127.0.0.1:${webPort} · 日志：.runtime/api.log、.runtime/web.log`);
  }
} catch (error) {
  console.error(error?.message ?? "PostgreSQL启动失败，查看 .runtime/postgres-start.log");
  await stop();
  process.exitCode = 1;
}
