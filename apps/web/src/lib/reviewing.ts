import { ApiError } from "./api";

export type Mark={criterion:string;judgement:string;quote:string;reason:string};
export type Audit={id:string;actor:string;actor_name:string;created_at:string;items:Mark[];correction_reason:string;supersedes:string|null};
export type ReviewSummary={revision:number;status:string;reviewer_count:number;disagreements:string[];history:Audit[];mastery:string};
export const reviewLabels:Record<string,string>={pending_review:"等待复核",single_review:"已有一位复核者，待交叉核对",disputed:"存在分歧，待逐项处理",needs_followup:"需要补充或澄清",consistent_review:"当前复核意见一致，仍不等于掌握认证",awaiting_your_review:"请先独立填写本人的复核"};
export const judgementLabels:Record<string,string>={met:"满足",partial:"部分满足",missing:"缺失",unsure:"不确定"};

export async function reviewRequest<T>(token:string,path="",body?:unknown):Promise<T>{
  const response=await fetch(`/api/v1/reviewing${path}`,{method:body===undefined?"GET":"POST",cache:"no-store",signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new ApiError(response.status,typeof data.detail==="string"?data.detail:"复核请求未完成，请检查输入或稍后重试。");}
  return response.json();
}
