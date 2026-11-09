"use client";
import {useEffect,useRef,useState} from "react";
import {request} from "@/lib/api";

type Admission={eligible:boolean;review_revision:number;checks:{id:string;ok:boolean;label:string}[]};
type Candidate={id:string;title:string;status:string;reason:string;due_at:string;initial:Admission;recheck:Admission|null;active_recheck:string|null};
type Ledger={policy:string;server_time:string;interval_hours:number;items:Candidate[];total?:number;next_offset?:number|null};
const labels:Record<string,string>={needs_evidence:"初次证据待补齐",waiting_interval:"等待延后复验",ready_for_recheck:"已到复验时间",recheck_in_progress:"复验进行中",recheck_needs_evidence:"复验证据待补齐",candidate_ready:"候选线索齐备，仍未认证掌握",needs_policy_review:"规则版本需重新核对",relation_changed:"绑定的关系已改变，原证据待重新核对"};

export function CandidateEvidence({revision,sourceId,busy,hasActive,onStart,onReload}:{revision:string;sourceId?:string;busy:boolean;hasActive:boolean;onStart:(id:string,reviewRevision:number)=>void;onReload:()=>void}){
  const [data,setData]=useState<Ledger|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
  const [offset,setOffset]=useState(0);
  const sequence=useRef(0);
  async function load(nextOffset=offset){const call=++sequence.current;setLoading(true);try{const query=new URLSearchParams();if(nextOffset)query.set("offset",String(nextOffset));if(sourceId)query.set("source_id",sourceId);const next=await request<Ledger>(`/candidates${query.size?`?${query}`:""}`);if(call===sequence.current){setData(next);setOffset(nextOffset);setError("");}}catch{if(call===sequence.current)setError("候选证据暂未读取成功；不影响原验证作答。");}finally{if(call===sequence.current)setLoading(false);}}
  useEffect(()=>{void load(0);return()=>{sequence.current++;};},[revision,sourceId]);
  return <section className="intake-card candidate-evidence"><h2>候选证据与延后复验</h2><p>解释复核、独立性观察、帮助和题族分别检查。满足候选条件也不会自动解锁。</p><button disabled={loading||busy} onClick={()=>{void load();}}>刷新候选证据</button>
    {error&&<p className="intake-error">{error}</p>}
    {data&&!data.items.length&&<p>先提交一个新情境，证据缺口会在这里显示。</p>}
    {data?.items.map(item=><details className="verification-criterion" key={item.id}><summary>{item.title} · {labels[item.status]}</summary><p>{item.reason}</p><p>复验最早时间：{new Date(item.due_at).toLocaleString("zh-CN")}，以服务器判断为准。</p><h3>初次验证条件</h3><ul>{item.initial.checks.map(c=><li key={c.id}>{c.ok?"已记录":"待补齐"}：{c.label}</li>)}</ul>{item.recheck&&<><h3>复验条件</h3><ul>{item.recheck.checks.map(c=><li key={c.id}>{c.ok?"已记录":"待补齐"}：{c.label}</li>)}</ul></>}
      {item.status==="ready_for_recheck"&&<><button disabled={busy||hasActive} onClick={()=>onStart(item.id,item.initial.review_revision)}>开始这次延后复验</button>{hasActive&&<p>先完成当前情境，复验不会覆盖草稿。</p>}</>}
      {item.active_recheck&&<button disabled={busy} onClick={onReload}>同步验证室，继续复验</button>}
    </details>)}
    {(data?.next_offset!=null||offset>0)&&<div className="intake-actions"><button disabled={busy||loading||data?.next_offset==null} onClick={()=>{void load(data!.next_offset!);}}>更早的候选记录</button><button disabled={busy||loading||offset===0} onClick={()=>{void load(0);}}>返回最近候选记录</button></div>}
    {data&&<small>规则{data.policy} · 间隔{data.interval_hours}小时为开发期假设，未校准为最佳间隔。观察记录是复核者的判断依据，不等于系统证明了现实独立性。</small>}
  </section>;
}
