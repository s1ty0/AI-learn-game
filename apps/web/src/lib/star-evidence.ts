export type EvidenceIntent={goal?:string;attempt?:string;source?:string};
export type EvidenceSummary={id:string;covered:boolean;counts:Record<string,number>};
export const evidenceLabels:Record<string,string>={needs_evidence:"待补证据",waiting_interval:"等待复验",ready_for_recheck:"可做复验",recheck_in_progress:"复验进行中",recheck_needs_evidence:"复验待补",candidate_ready:"候选齐备，未认证",needs_policy_review:"规则待核对"};
export function badge(summary:EvidenceSummary|undefined){
  if(!summary)return "";
  const counts=summary.counts;
  if((counts.needs_evidence??0)+(counts.recheck_needs_evidence??0)+(counts.needs_policy_review??0)>0)return "有待补证据";
  if(counts.ready_for_recheck)return "有可做复验";
  if(counts.recheck_in_progress)return "有进行中复验";
  if(counts.waiting_interval)return "有等待复验";
  if(counts.candidate_ready)return "有候选记录 · 未认证";
  return summary.covered?"尚无验证记录":"验证覆盖待补";
}
