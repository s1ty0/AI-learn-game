"use client";

import { useEffect, useRef, useState } from "react";
import { request, ApiError } from "@/lib/api";

type Evidence = { task_id: string; kind: string; outcome: string; explanation: string; hint_used: boolean; feedback: string; prompt?: string; choice?: number | null; options?: string[]; task_version?: string };
type Profile = { revision: number; version: string; answered: number; total: number; finished: boolean;
  task: { id: string; domain: string; kind: string; prompt: string; options: string[]; hint: string | null } | null;
  domains: { name: string; tested: number; evidence: Evidence[] }[];
  recommendation: { title: string; reason: string }; last_feedback: string | null };
type Action = { base_revision: number; operation_key: string; action: "answer" | "hint" | "finish"; task_id: string | null; choice: number | null; explanation: string };
const labels: Record<string,string> = {unknown:"待验证：选择了不知道",needs_check:"待核查：需要换情境确认",supported_choice:"借助线索选对，仍待独立验证",independent_choice:"独立选择符合规则，仅为初步线索"};

export function Intake({ onBack }: { onBack: () => void }) {
  const [profile,setProfile]=useState<Profile|null>(null);
  const [choice,setChoice]=useState<number|null>(null);
  const [explanation,setExplanation]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [uncertain,setUncertain]=useState(false);
  const [intro,setIntro]=useState(true);
  const [feedback,setFeedback]=useState("");
  const [previousDraft,setPreviousDraft]=useState("");
  const pending=useRef<Action|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  async function load() {
    setBusy(true);
    try { const next=await request<Profile>("/intake");
      if(profile?.task && profile.task.id!==next.task?.id && (choice!==null || explanation)) {
        setPreviousDraft(`${profile.task.prompt}\n我的选择：${choice===null?"尚未选择":profile.task.options[choice]}\n我的理由：${explanation}`);
        setChoice(null);setExplanation("");
      }
      setProfile(next);setError("");setUncertain(false);setIntro(next.answered===0 && !next.finished);
    }
    catch {setError("起点探测暂未连接。可以重试，也可以继续原来的探索。");}
    finally {setBusy(false);}
  }
  useEffect(()=>{void load();heading.current?.focus();},[]);
  async function send(action: Action["action"],unknown=false) {
    if(!profile || busy || uncertain)return;
    const candidate={base_revision:profile.revision,action,task_id:profile.task?.id??null,choice:action==="answer" && !unknown?choice:null,explanation:action==="answer"?explanation:""};
    const old=pending.current;
    const body=old && JSON.stringify({...old,operation_key:undefined})===JSON.stringify({...candidate,operation_key:undefined})?old:{...candidate,operation_key:crypto.randomUUID()};
    pending.current=body;setBusy(true);setError("");
    try {
      const next=await request<Profile>("/intake/actions",body);setProfile(next);pending.current=null;
      if(action==="answer"){setChoice(null);setExplanation("");setFeedback(next.last_feedback??"");}
      if(action==="finish")setFeedback("");
    } catch(err){
      setUncertain(err instanceof ApiError && err.status===409);
      setError(err instanceof ApiError && err.status===409?"另一处更新了画像。当前输入保留，请读取最新进度再核对当前题。":"这次提交尚未确认。输入保留；原样重试不会重复记录。");
    } finally {setBusy(false);}
  }
  return <main className="intake-room">
    <div className="intake-top"><button disabled={busy} onClick={onBack}>← 回到群岛</button><span>{profile?`已记录 ${profile.answered} / ${profile.total}`:"连接起点探测"}</span></div>
    <h1 ref={heading} tabIndex={-1}>找到我的起点</h1>
    <p className="intake-muted">不计时，不排等级。约10个短任务，只用来寻找更合适的入口。</p>
    {previousDraft && <details className="intake-feedback"><summary>上一题未提交的输入，仅在当前页面保留</summary><p style={{whiteSpace:"pre-wrap"}}>{previousDraft}</p></details>}
    {error && <div className="intake-error" role="alert"><p>{error}</p><button disabled={busy} onClick={()=>{void load();}}>读取最新进度</button>{uncertain && <small>读取时保留输入；提交前请核对是否仍属于当前题。</small>}</div>}
    {!profile ? <button disabled={busy} onClick={()=>{void load();}}>重新连接</button> : profile.finished ? <>
      <section className="intake-card"><span>本次起点记录已保存</span><h2>建议试试：{profile.recommendation.title}</h2><p>{profile.recommendation.reason}</p><p className="intake-muted">这是起点建议。未探测内容保持未知；当前版本不自动跳级或改变已有解锁。</p><button onClick={onBack}>回到当前探索</button></section>
      <div className="intake-summary">{profile.domains.map(domain=><section className="intake-card" key={domain.name}><h2>{domain.name}</h2>{!domain.tested?<p>尚未探测，保持未知。</p>:domain.evidence.map(e=><details key={e.task_id}><summary>{e.kind} · {labels[e.outcome]}</summary><p>{e.prompt}</p><p>我的选择：{e.choice == null ? "不知道" : e.options?.[e.choice]}</p><p>{e.feedback}</p><small>任务 {e.task_id} · {e.task_version}</small>{e.explanation && <p>我的理由：{e.explanation}</p>}</details>)}</section>)}</div>
    </> : intro ? <section className="intake-card"><h2>先探一小步</h2><p>数据、数量、程序、不确定性和评估，每次只看一个情境。可以选择“不知道”，也可以中途结束。</p><p>已有岛屿和星图保持原样。已提交回答可续接；尚未提交的输入只保留在当前页面。</p><button onClick={()=>setIntro(false)}>开始探测</button></section> : <>
      {feedback && <div className="intake-feedback" role="status"><strong>上一小步</strong><p>{feedback}</p><small>选择题结果仅为初步线索，不代表独立掌握。</small></div>}
      {profile.task && <section className="intake-card" key={profile.task.id}><span>第 {profile.answered+1} 步 · {profile.task.domain}</span><h2>{profile.task.prompt}</h2>
        <fieldset disabled={busy || uncertain}><legend>你的选择</legend>{profile.task.options.map((option,index)=><label className="intake-option" key={option}><input type="radio" name="entry-choice" checked={choice===index} onChange={()=>setChoice(index)}/><span>{option}</span></label>)}</fieldset>
        <label className="intake-reason">为什么这样选？可留空<textarea aria-label="起点探测理由" disabled={busy || uncertain} maxLength={1500} rows={3} value={explanation} onChange={e=>setExplanation(e.target.value)}/></label>
        {profile.task.hint && <p className="intake-hint">线索：{profile.task.hint}</p>}
        <div className="intake-actions"><button disabled={busy || uncertain || choice===null} onClick={()=>{void send("answer");}}>记录并继续</button><button disabled={busy || uncertain} onClick={()=>{void send("answer",true);}}>还不知道</button>{!profile.task.hint && <button disabled={busy || uncertain} onClick={()=>{void send("hint");}}>给一点线索</button>}</div>
      </section>}
      <details className="intake-stop"><summary>暂时到这里</summary><p>保存已提交证据并结束本次画像。未探测能力保留为未知；本版暂不提供重新探测。</p><button disabled={busy || uncertain} onClick={()=>{void send("finish");}}>保存已有记录并结束</button></details>
    </>}
  </main>;
}
