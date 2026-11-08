"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, request } from "@/lib/api";

type Target = {id:string;title:string;stage:number};
type Step = {id:string;prompt:string;options:string[];hint:string|null;bridge:string|null;kind:string};
type History = {action:string;target:string;target_title?:string;stage:number;feedback?:string;cause?:string;feedback_text?:string;outcome?:string;created_at:string;prompt?:string;task_id?:string};
type Guide = {revision:number;version:string;target:Target|null;available:(Target & {optional:boolean})[];reason:string;profile_note:string;task:Step|null;mode:string|null;history:History[]};
type Action = {base_revision:number;operation_key:string;action:"choose"|"feedback"|"hint"|"answer";target:string;stage:number;feedback?:string;cause?:string;task_id?:string;choice?:number|null};
const feelings:Record<string,string>={hard:"太难了",easy:"太简单",example:"换个例子"};
const outcomes:Record<string,string>={unknown:"保留待验证",needs_check:"换个情境再检查",independent_choice:"独立选择符合规则，仅为初步线索",supported_choice:"支持下完成，仍需独立验证"};

export function Guidance({onBack,onEnter}:{onBack:()=>void;onEnter:(id:string)=>Promise<void>}) {
  const [guide,setGuide]=useState<Guide|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [blocked,setBlocked]=useState(false),[choice,setChoice]=useState<number|null>(null),[cause,setCause]=useState("concept");
  const [oldInput,setOldInput]=useState("");
  const pending=useRef<Action|null>(null),heading=useRef<HTMLHeadingElement>(null);
  async function load(){setBusy(true);try{
    const next=await request<Guide>("/guidance");
    if(choice!==null && guide?.task?.id!==next.task?.id){setOldInput(`${guide?.task?.prompt}：${guide?.task?.options[choice]}`);setChoice(null);}
    setGuide(next);setError("");setBlocked(false);pending.current=null;
  }catch{setError("领航暂时未连接。可以重试，原探索记录仍在。");}finally{setBusy(false);}}
  useEffect(()=>{void load();heading.current?.focus();},[]);
  async function send(action:Action["action"],extra:Partial<Action>={}){
    if(!guide?.target || busy || blocked)return;
    const candidate={base_revision:guide.revision,action,target:guide.target.id,stage:guide.target.stage,...extra};
    const old=pending.current;
    const body=old && JSON.stringify({...old,operation_key:undefined})===JSON.stringify({...candidate,operation_key:undefined})?old:{...candidate,operation_key:crypto.randomUUID()};
    pending.current=body;setBusy(true);setError("");
    try{const next=await request<Guide>("/guidance/actions",body);setGuide(next);pending.current=null;if(action!=="hint")setChoice(null);}
    catch(err){const conflict=err instanceof ApiError && err.status===409;setBlocked(conflict);setError(conflict?"进度或领航已更新。当前选择保留，先读取最新建议。":"提交尚未确认，选择仍保留。原样重试不会重复记录。");}
    finally{setBusy(false);}
  }
  async function enter(){if(!guide?.target)return;setBusy(true);try{await onEnter(guide.target.id);}catch{setError("探索入口已变化或暂未连接，请读取最新建议再进入。");}finally{setBusy(false);}}
  const answer=guide?.history.filter(e=>e.action==="answer" && e.target===guide.target?.id && e.stage===guide.target?.stage && e.task_id===guide.task?.id).at(-1);
  return <main className="intake-room guidance-room"><div className="intake-top"><button disabled={busy} onClick={onBack}>回到群岛</button><span>一步领航 · {guide?`v${guide.revision}`:"连接中"}</span></div>
    <h1 tabIndex={-1} ref={heading}>下一束光</h1><p className="intake-muted">每次一个可达目标。困难先找原因，熟悉就做短探测。</p>
    {error && <div className="intake-error" role="alert"><p>{error}</p><button disabled={busy} onClick={()=>{void load();}}>读取最新建议</button></div>}
    {oldInput && <details className="intake-feedback"><summary>先前未提交的选择</summary><p>{oldInput}</p></details>}
    {!guide?<button disabled={busy} onClick={()=>{void load();}}>重新连接</button>:!guide.target?<section className="intake-card"><h2>这一程的探索已完成</h2><p>已开放主线与支线均已探索，可回群岛重游或整理星图。正式掌握仍待验证。</p><button onClick={onBack}>回到群岛继续整理</button></section>:<>
      <section className="intake-card"><span>当前可达 · 机关 {guide.target.stage+1}/3</span><h2>{guide.target.title}</h2><p>{guide.reason}</p><p className="intake-muted">{guide.profile_note}</p>
        <label className="intake-reason">其他可达点<select aria-label="选择领航探索点" disabled={busy||blocked} value={guide.target.id} onChange={e=>{const target=guide.available.find(n=>n.id===e.target.value)!;void send("choose",{target:target.id,stage:target.stage});}}>{guide.available.map(n=><option key={n.id} value={n.id}>{n.title}{n.optional?" · 可选支线":""}</option>)}</select></label>
        <button className="guidance-enter" disabled={busy||blocked} onClick={()=>{void enter();}}>进入这一步探索</button>
      </section>
      <section className="intake-card"><h2>这一步感觉如何？</h2><label className="intake-reason">困难更像哪一种？<select aria-label="困难原因" value={cause} disabled={busy||blocked} onChange={e=>setCause(e.target.value)}><option value="concept">关系还没想通</option><option value="term">术语看不懂</option><option value="operation">操作不方便</option></select></label><div className="intake-actions">{Object.entries(feelings).map(([key,label])=><button key={key} disabled={busy||blocked} onClick={()=>{void send("feedback",{feedback:key,...(key==="hard"?{cause}:{})});}}>{label}</button>)}</div></section>
      {guide.task && <section className="intake-card"><span>{guide.task.kind}</span>{guide.task.bridge && <p className="intake-hint">{guide.task.bridge}</p>}<h2>{guide.task.prompt}</h2><fieldset disabled={busy||blocked}><legend>先选一个结果</legend>{guide.task.options.map((option,i)=><label className="intake-option" key={option}><input type="radio" name="guide-choice" checked={choice===i} onChange={()=>setChoice(i)}/><span>{option}</span></label>)}</fieldset>{guide.task.hint && <p className="intake-hint">{guide.task.hint}</p>}<div className="intake-actions"><button disabled={busy||blocked||choice===null} onClick={()=>{void send("answer",{task_id:guide.task!.id,choice});}}>记录这个判断</button><button disabled={busy||blocked} onClick={()=>{void send("answer",{task_id:guide.task!.id,choice:null});}}>还不知道</button>{!guide.task.hint && <button disabled={busy||blocked} onClick={()=>{void send("hint",{task_id:guide.task!.id});}}>给一点线索</button>}</div><small>练习不改原关卡进度。同题复做和两个例子轮换不增加独立掌握证据。</small></section>}
      {answer && <section className="intake-feedback" role="status"><p>{answer.feedback_text}</p><small>{outcomes[answer.outcome??"unknown"]}</small><button disabled={busy||blocked} onClick={()=>{void enter();}}>回到关卡继续</button></section>}
    </>}
    {!!guide?.history.length && <details className="intake-stop"><summary>最近20条领航足迹</summary>{[...guide.history].reverse().map((e,i)=><p key={i}>{new Date(e.created_at).toLocaleString("zh-CN")} · {e.target_title??e.target} · {feelings[e.feedback??""]??({choose:"选择路线",hint:"使用线索",answer:"记录判断",feedback:"反馈本步感受"} as Record<string,string>)[e.action]}{e.cause==="operation"?" · 操作困难":""}{e.outcome?` · ${outcomes[e.outcome]}`:""}</p>)}</details>}
  </main>;
}
