"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, request } from "@/lib/api";
import { loadDraft, writeDraft } from "@/lib/draft-store";
import { reviewLabels, judgementLabels, type ReviewSummary } from "@/lib/reviewing";

type Task={id:string;goal:string;title:string;prompt:string;options:string[];repeat_family:boolean};
type Criterion={id:string;title:string;requirement:string};
type Review={criterion:string;judgement:string;quote:string;reason:string};
type Report={id:string;title:string;prompt:string;options:string[];choice:number|null;explanation:string;used_help:boolean;choice_matches:boolean|null;independence:string;status:string;rubric:Criterion[];rationale:string;task_version:string;graph_revision:number;self_reviews:{created_at:string;review:Review[]}[];review_state?:ReviewSummary};
type State={revision:number;goals:{id:string;title:string}[];active:Task|null;reports:Report[]};
type Draft={choice:number|null;explanation:string;used_help:boolean};
const empty:Draft={choice:null,explanation:"",used_help:false};

export function Verification({onBack}:{onBack:()=>void}){
  const [state,setState]=useState<State|null>(null),[form,setForm]=useState<Draft>(empty),[reportId,setReportId]=useState("");
  const [review,setReview]=useState<Review[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [blocked,setBlocked]=useState(false),[notice,setNotice]=useState("");
  const [previousDraft,setPreviousDraft]=useState("");
  const draftEpoch=useRef(0);
  const pending=useRef<Record<string,unknown>|null>(null),heading=useRef<HTMLHeadingElement>(null);
  const report=state?.reports.find(r=>r.id===reportId)??state?.reports.at(-1);
  function preserve(next:Draft){setForm(next);const epoch=++draftEpoch.current;if(state?.active)void writeDraft(next,`verification:${state.active.id}`).then(()=>{if(epoch===draftEpoch.current)setNotice("本机草稿已暂存，尚未提交。");}).catch(()=>setError("本机草稿暂存不可用，请先提交作答保留原文。"));}
  async function load(){setBusy(true);try{
    const next=await request<State>("/verification");
    const draft=next.active?await loadDraft<Draft>(`verification:${next.active.id}`).catch(()=>undefined):undefined;
    if(state?.active&&state.active.id!==next.active?.id&&form.explanation)setPreviousDraft(`${state.active.prompt}\n我的未提交解释：${form.explanation}`);
    setState(next);setForm(draft??empty);setBlocked(false);setError("");pending.current=null;
    setNotice(draft?"已找回本标签页的未提交草稿。":"已提交原文仍保留；其他题的本机草稿不会覆盖当前题。");
  }catch{setError("验证室暂时未连接。可以重试，或返回原探索。");}finally{setBusy(false);}}
  useEffect(()=>{void load();heading.current?.focus();},[]);
  async function send(action:string,extra:Record<string,unknown>){
    if(!state||busy||blocked)return;
    const candidate={base_revision:state.revision,action,...extra};
    const old=pending.current;
    const body=old&&JSON.stringify({...old,operation_key:undefined})===JSON.stringify({...candidate,operation_key:undefined})?old:{...candidate,operation_key:crypto.randomUUID()};
    pending.current=body;setBusy(true);setError("");
    try{
      const next=await request<State>("/verification/actions",body);setState(next);pending.current=null;
      if(action==="submit"&&state.active){draftEpoch.current++;void writeDraft(undefined,`verification:${state.active.id}`).catch(()=>setNotice("作答已提交，本机旧草稿清除尚未确认。"));setForm(empty);setReportId(state.active.id);setReview([]);setNotice("作答原文已保存，解释仍待独立复核。");}
      if(action==="start"){setForm(empty);setNotice("先独立尝试；提交后才展示参考关系与量规。使用过资料请如实标记。");}
      if(action==="self_review")setNotice("复盘已保存。本人复盘不会替代独立复核，解释仍待复核。");
    }catch(err){
      const conflict=err instanceof ApiError&&err.status===409;setBlocked(conflict);
      setError(conflict?"验证记录已更新。当前草稿保留，请先读取最新记录。":err instanceof ApiError&&err.status===422?"请检查：解释不能空白；复盘要逐项说明理由，满足或部分满足须引用作答原文。":"提交未确认，原文保留。原样重试不会重复记录。");
    }finally{setBusy(false);}
  }
  function editReview(criterion:string,field:keyof Review,value:string){
    setReview(old=>{const found=old.find(i=>i.criterion===criterion)??{criterion,judgement:"unsure",quote:"",reason:""};return [...old.filter(i=>i.criterion!==criterion),{...found,[field]:value}];});
  }
  return <main className="intake-room verification-room"><div className="intake-top"><button disabled={busy} onClick={onBack}>回到群岛</button><span>验证室 · {state?`v${state.revision}`:"连接中"}</span></div><h1 ref={heading} tabIndex={-1}>把关系讲通</h1>
    <p className="intake-muted">先在新情境里判断，再解释联系和条件。选择检查与解释复核分别记录。</p>
    {error&&<div className="intake-error" role="alert"><p>{error}</p><button disabled={busy} onClick={()=>{void load();}}>读取最新验证记录</button></div>}
    {notice&&<p className="intake-muted" role="status">{notice}</p>}
    {previousDraft&&<details className="intake-feedback"><summary>上一情境未提交的本机解释</summary><pre className="verification-original">{previousDraft}</pre></details>}
    {!state?<button disabled={busy} onClick={()=>{void load();}}>重新连接</button>:state.active?<section className="intake-card"><span>{state.active.repeat_family?"同题族重做：保留练习记录，不新增独立证据":"新情境尝试：独立性仍待确认"}</span><h2>{state.active.title}</h2><p>{state.active.prompt}</p>
      <fieldset disabled={busy||blocked}><legend>你的判断（不选则记录不知道）</legend>{state.active.options.map((o,i)=><label className="intake-option" key={o}><input type="radio" name="transfer-choice" checked={form.choice===i} onChange={()=>preserve({...form,choice:i})}/><span>{o}</span></label>)}<button onClick={()=>preserve({...form,choice:null})}>改为不知道</button></fieldset>
      <label className="intake-reason">我的解释、条件与反例<textarea aria-label="验证解释" disabled={busy||blocked} rows={7} maxLength={5000} value={form.explanation} onChange={e=>preserve({...form,explanation:e.target.value})}/></label>
      <label className="intake-option"><input type="checkbox" disabled={busy||blocked} checked={form.used_help} onChange={e=>preserve({...form,used_help:e.target.checked})}/>这次查看过资料、答案或使用了他人/AI帮助</label>
      <small>草稿在本标签页暂存；提交成功后才进入数据库历史。浏览器清理存储后不保证草稿恢复。</small>
      <button className="guidance-enter" disabled={busy||blocked||!form.explanation.trim()} onClick={()=>{void send("submit",{attempt_id:state.active!.id,...form});}}>提交解释，留下原文</button>
    </section>:<section className="intake-card"><h2>选一个已探索的关系</h2><p>当前四类验证按对应知识探索完成后开放。每次只展开一个情境，先尝试再对照量规。</p>{state.goals.map(g=><button className="verification-goal" key={g.id} disabled={busy||blocked} onClick={()=>{void send("start",{goal:g.id});}}>{g.title}</button>)}{!state.goals.length&&<p>先点亮第一束光，验证入口随后开放。</p>}</section>}
    {!!state?.reports.length&&<section className="intake-card"><h2>作答与复盘记录</h2><label className="intake-reason">选择作答<select aria-label="选择验证记录" value={report?.id??""} onChange={e=>{setReportId(e.target.value);setReview([]);}}>{[...state.reports].reverse().map((r,i)=><option key={r.id} value={r.id}>{r.title} · 记录{state.reports.length-i}</option>)}</select></label>
      {report&&<><p>{report.prompt}</p><p>我的判断：{report.choice===null?"不知道":report.options[report.choice]}</p><pre className="verification-original">{report.explanation}</pre><p>选择检查：{report.choice_matches===null?"待验证":report.choice_matches?"符合本题规则":"与本题规则不符"} · 解释：待独立复核</p><p className="intake-muted">{report.independence==="supported"?"本次标记使用帮助":report.independence==="repeat_family"?"同题族重做":"未标记帮助，独立性仍未确认"}；不自动授予掌握或解锁。</p>
        <details><summary>对照关系与量规，复盘自己的解释</summary><p>{report.rationale}</p><p>这是本人复盘。判断会留痕，不能代替独立评价。</p>{report.rubric.map(c=>{const entry=review.find(i=>i.criterion===c.id);return <section className="verification-criterion" key={c.id}><h3>{c.title}</h3><p>{c.requirement}</p><label className="intake-reason">我的判断<select aria-label={`${c.title}判断`} disabled={busy||blocked} value={entry?.judgement??"unsure"} onChange={e=>editReview(c.id,"judgement",e.target.value)}><option value="unsure">不确定</option><option value="met">满足</option><option value="partial">部分满足</option><option value="missing">缺失</option></select></label><label className="intake-reason">引用我的原文<input aria-label={`${c.title}原文`} disabled={busy||blocked} maxLength={1000} value={entry?.quote??""} onChange={e=>editReview(c.id,"quote",e.target.value)}/></label><label className="intake-reason">判断理由<textarea aria-label={`${c.title}理由`} disabled={busy||blocked} maxLength={1000} rows={2} value={entry?.reason??""} onChange={e=>editReview(c.id,"reason",e.target.value)}/></label></section>})}<button disabled={busy||blocked||review.length!==3} onClick={()=>{void send("self_review",{attempt_id:report.id,review});}}>保存本人复盘</button></details>
        {!!report.self_reviews.length&&<details><summary>回看已保存复盘（{report.self_reviews.length}次）</summary>{report.self_reviews.map((r,i)=><div key={i}><p>{new Date(r.created_at).toLocaleString("zh-CN")}</p>{r.review.map(item=><p key={item.criterion}>{report.rubric.find(c=>c.id===item.criterion)?.title}：{({met:"满足",partial:"部分满足",missing:"缺失",unsure:"不确定"} as Record<string,string>)[item.judgement]} · {item.quote} · {item.reason}</p>)}</div>)}</details>}
        {report.review_state&&<details><summary>查看复核意见：{reviewLabels[report.review_state.status]}</summary><button disabled={busy} onClick={()=>{void load();}}>更新验证与复核记录</button><p>{report.review_state.reviewer_count}位复核者；分歧按条保留，不自动授予掌握。</p>{report.review_state.history.map(e=><section className="verification-criterion" key={e.id}><h3>{e.actor_name}</h3>{e.items.map(item=><p key={item.criterion}>{report.rubric.find(c=>c.id===item.criterion)?.title}：{judgementLabels[item.judgement]} · {item.quote} · {item.reason}</p>)}{e.supersedes&&<p>追加纠正：{e.correction_reason}</p>}</section>)}</details>}<small>任务版本 {report.task_version} · 开始时星图版本 v{report.graph_revision} · 仅展示最近至多10次提交，旧记录仍保留。</small>
      </>}
    </section>}
  </main>;
}
