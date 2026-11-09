import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
let password;
try { ({password}=JSON.parse(await readFile(path.join(root,".runtime/db-secret.json"),"utf8"))); }
catch { console.error("本机数据库配置不可读，请先运行pnpm dev；未输出配置内容。");process.exit(1); }
const python=path.join(root,"apps/api/.venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
const child=spawn(python,["-m","app.review_access",...process.argv.slice(2)],{cwd:path.join(root,"apps/api"),windowsHide:true,
  env:{...process.env,DATABASE_URL:`postgresql+psycopg://learnai:${password}@127.0.0.1:54329/learnai`},stdio:"inherit"});
child.on("exit",code=>{process.exitCode=code??1;});
child.on("error",()=>{console.error("复核权限工具未能启动，请检查本地Python环境。");process.exitCode=1;});
