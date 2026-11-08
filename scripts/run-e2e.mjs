import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)], {
  cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(root, ".runtime/browsers") },
});
child.on("exit", code => { process.exitCode = code ?? 1; });
