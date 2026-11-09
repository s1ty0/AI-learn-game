"use client";
import {useEffect,useState} from "react";
import {ApiError,request} from "@/lib/api";

type Preview={revision_id:string;source_attempt:string;graph_revision:number;edge:{label:string;note:string};focuses:{id:string;title:string}[];note:string};
export function RevisionChallenge({id,reload,busy,hasActive,completed,onStart,onRepair}:{id:string;reload:number;busy:boolean;hasActive:boolean;completed:boolean;onStart:(id:string,focus:string,graph:number)=>void;onRepair?:()=>void}){
 const [preview,setPreview]=useState<Preview|null>(null),[focus,setFocus]=useState(""),[error,setError]=useState(""),[nonce,setNonce]=useState(0);
 useEffect(()=>{let live=true;setPreview(null);setError("");void request<Preview>(`/relation-revisions/challenge/${encodeURIComponent(id)}`).then(value=>{if(live){setPreview(value);setFocus(old=>value.focuses.some(f=>f.id===old)?old:value.focuses[0]?.id??"");}}).catch(err=>{if(live)setError(err instanceof ApiError?err.message:"挑战目标暂未连接，已保存修订仍保留。");});return()=>{live=false;};},[id,reload,nonce]);
 return <section className="intake-card revision-challenge"><h2>挑战这次修订</h2><p>每次只练一个缺口。先判断和解释，提交后才显示参考。</p>
 {error&&<div className="intake-error"><p>{error}</p><button disabled={busy} onClick={()=>setNonce(n=>n+1)}>重读挑战目标</button></div>}
 {preview&&<><details open={!hasActive&&!completed}><summary>修订命题与目标 · 星图v{preview.graph_revision}</summary><pre className="verification-original">{preview.edge.label}{"\n"}{preview.edge.note}</pre><fieldset disabled={busy||hasActive}><legend>这次练哪一处？</legend>{preview.focuses.map(f=><label key={f.id} className="intake-option"><input type="radio" name="revision-focus" value={f.id} checked={focus===f.id} onChange={()=>setFocus(f.id)}/>{f.title}</label>)}</fieldset><p className="intake-muted">{preview.note}</p></details><button disabled={busy||hasActive||!focus} onClick={()=>onStart(id,focus,preview.graph_revision)}>开始这次缺口挑战</button>{completed&&<p className="intake-muted">再次挑战会保留同题族记录。先看下方反馈，再决定是否重练。</p>}</>}
 {hasActive&&<p>先完成下方进行中的情境，不覆盖已有作答。</p>}{onRepair&&<button disabled={busy} onClick={onRepair}>回到这条关系的修订任务</button>}
 </section>;
}
