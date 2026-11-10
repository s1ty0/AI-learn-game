// Private local backup, deliberately separate from the source-only checkpoint.
import {readFile,mkdir,stat,open} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {spawnSync} from "node:child_process";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const require=createRequire(import.meta.url),binary=createRequire(require.resolve("embedded-postgres"));
const entry=binary.resolve(process.platform==="win32"?"@embedded-postgres/windows-x64":"@embedded-postgres/linux-x64");
const {pg_ctl}=await import(new URL(`file:///${entry.replaceAll("\\","/")}`));
const {password}=JSON.parse(await readFile(path.join(root,".runtime/db-secret.json"),"utf8"));
const folder=path.join(root,".runtime/db-backups");await mkdir(folder,{recursive:true});
const stamp=new Date().toISOString().replaceAll(":","-");const output=path.join(folder,`learnai-${stamp}.dump`);
const pgDump=process.env.LEARN_PG_DUMP??path.join(path.dirname(pg_ctl),process.platform==="win32"?"pg_dump.exe":"pg_dump");
const result=spawnSync(pgDump,["-h","127.0.0.1","-p","54329","-U","learnai","-d","learnai","-Fc","-f",output],{env:{...process.env,PGPASSWORD:password},windowsHide:true,encoding:"utf8"});
if(result.status!==0){console.error("数据库备份未完成，请检查本机PostgreSQL；未输出连接凭据。");process.exit(1);}
const file=await open(output,"r"),header=Buffer.alloc(5);
try{await file.read(header);}finally{await file.close();}
if(header.toString()!=="PGDMP")throw new Error("Unexpected database backup format");
console.log(`Private database backup: ${output}\nBytes: ${(await stat(output)).size}; custom PostgreSQL format. Restore drill is a separate acceptance step.`);
