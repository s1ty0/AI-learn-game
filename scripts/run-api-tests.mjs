import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { password } = JSON.parse(await readFile(path.join(root, ".runtime/db-secret.json"), "utf8"));
const python = path.join(root, "apps/api/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const child = spawn(python, ["-m", "pytest", "-q"], { cwd: path.join(root, "apps/api"), windowsHide: true,
  env: { ...process.env, DATABASE_URL: `postgresql+psycopg://learnai:${password}@127.0.0.1:54329/learnai` }, stdio: "inherit" });
child.on("exit", code => { process.exitCode = code ?? 1; });
