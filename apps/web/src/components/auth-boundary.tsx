"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {accountHeaders,setAccountIdentity} from "@/lib/auth-identity";
import {flushDraftWrites,setDraftOwner} from "@/lib/draft-store";

type Session={user:{id:string;username:string}|null;mode:"account"|"local-demo"|"required";demo_available:boolean;invite_required:boolean};
export function AuthBoundary({children}:{children:ReactNode}){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[form,setForm]=useState(false),[register,setRegister]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [username,setUsername]=useState(""),[password,setPassword]=useState(""),[invite,setInvite]=useState("");
 const sequence=useRef(0),channel=useRef<BroadcastChannel|null>(null);
 function rememberIntent(value:string){try{sessionStorage.setItem("learnai-auth-intent",value);}catch{/* Storage can be unavailable; server identity still applies. */}}
 function apply(next:Session){setAccountIdentity(next.user?.id??"local-demo");setDraftOwner(next.user?.id??"local-demo");setSession(next);}
 function changed(){channel.current?.postMessage("changed");}
 async function load(){const call=++sequence.current;setLoading(true);setError("");try{
  const response=await fetch("/api/v1/auth/session",{cache:"no-store",signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();const next:Session=await response.json();if(call!==sequence.current)return;apply(next);
  let accountIntent=false;try{accountIntent=sessionStorage.getItem("learnai-auth-intent")==="account";}catch{}
  setForm(!next.user&&(next.mode==="required"||accountIntent));
 }catch{if(call===sequence.current)setError("账号服务暂未连接，请重试；你的存档仍保留。");}finally{if(call===sequence.current)setLoading(false);}}
 useEffect(()=>{void load();const expire=()=>{rememberIntent("account");void load();};window.addEventListener("learnai-auth-expired",expire);channel.current=typeof BroadcastChannel!=="undefined"?new BroadcastChannel("learnai-account"):null;if(channel.current)channel.current.onmessage=()=>{rememberIntent("account");window.location.reload();};return()=>{sequence.current++;window.removeEventListener("learnai-auth-expired",expire);channel.current?.close();};},[]);
 async function send(action:"register"|"login"|"logout"){
  if(busy)return;setBusy(true);setError("");try{
   if(action==="logout")await flushDraftWrites().catch(()=>undefined);
   const response=await fetch(`/api/v1/auth/${action}`,{method:"POST",headers:{"Content-Type":"application/json","X-LearnAI-Request":"1",...accountHeaders()},body:JSON.stringify(action==="logout"?{}:{username,password,...(action==="register"?{invite}:{})}),signal:AbortSignal.timeout(8000)});
   const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(typeof result.detail==="string"?result.detail:"请检查用户名、密码长度与邀请码后重试。");
   setPassword("");setInvite("");rememberIntent("account");
   changed();window.location.reload();
  }catch(err){setError(err instanceof Error?err.message:"请求尚未确认，请重新读取账号状态。");}finally{setBusy(false);}
 }
 async function openForm(){
   setBusy(true);setError("");
   try{await flushDraftWrites();setForm(true);}
   catch{setError("本机草稿尚未保存，请先处理草稿再切换账号。");}
   finally{setBusy(false);}
 }
 if(loading||!session)return <main className="auth-screen"><h1>连接你的学习档案</h1>{error?<><p role="alert">{error}</p><button onClick={()=>{void load();}}>重新连接账号</button></>:<p role="status">正在确认账号与存档…</p>}</main>;
 if(form)return <main className="auth-screen"><section className="auth-card"><h1>{register?"创建自己的学习档案":"回到你的群岛"}</h1><p>进度、星图和作答分别保存到你的账号。</p>{error&&<p className="auth-error" role="alert">{error}</p>}
 <form onSubmit={e=>{e.preventDefault();void send(register?"register":"login");}}><label>用户名<input aria-label="账号用户名" autoComplete="username" pattern="[A-Za-z0-9_\-]{3,40}" minLength={3} maxLength={40} required disabled={busy} value={username} onChange={e=>setUsername(e.target.value)}/></label><small>3至40位字母、数字、下划线或短横线，不区分大小写。</small><label>密码<input aria-label="账号密码" type="password" autoComplete={register?"new-password":"current-password"} minLength={12} maxLength={128} required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label><small>12至128个字符。</small>{register&&session.invite_required&&<label>邀请码<input aria-label="账号邀请码" autoComplete="off" maxLength={200} required disabled={busy} value={invite} onChange={e=>setInvite(e.target.value)}/></label>}<button disabled={busy} type="submit">{busy?"正在确认…":register?"创建账号并进入":"登录并继续"}</button></form>
 <button disabled={busy} onClick={()=>{setRegister(v=>!v);setPassword("");setError("");}}>{register?"已有账号，去登录":"没有账号，创建一个"}</button><button disabled={busy} onClick={()=>{void load();}}>重新读取账号状态</button>
 {session.user&&<button disabled={busy} onClick={()=>setForm(false)}>返回当前账号的游戏</button>}{session.demo_available&&!session.user&&<button disabled={busy} onClick={()=>{rememberIntent("demo");setForm(false);setError("");}}>继续本机旧档案</button>}
 {register&&<small>新账号从独立进度开始，已有本机档案不会自动归入。</small>}</section></main>;
 return <><aside className="auth-toolbar" aria-label="当前学习账号"><span>{session.user?session.user.username:"本机旧档案"}</span><button disabled={busy} onClick={()=>{void openForm();}}>{session.user?"切换账号":"登录 / 创建账号"}</button>{session.user&&<button disabled={busy} onClick={()=>{void send("logout");}}>退出登录</button>}{error&&<span role="alert">{error}</span>}</aside><div key={session.user?.id??"local-demo"}>{children}</div></>;
}
