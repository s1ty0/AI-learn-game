import type { LabState } from "./expedition";

export const frontierIds = ["rmsnorm", "rope", "gqa", "swiglu", "split", "leakage", "overfit", "schedule"];
export function normValues(scale: number, shift: number, kind: string) {
  const input = [scale + shift, 2*scale + shift], mean = (input[0]+input[1])/2;
  const rms = Math.sqrt((input[0]**2+input[1]**2)/2+1e-5);
  const deviation = Math.sqrt(input.reduce((sum,x)=>sum+(x-mean)**2,0)/2+1e-5);
  const normalized = input.map(x=>x/rms), centered = input.map(x=>(x-mean)/deviation);
  const output = kind === "rms" ? normalized : kind === "layer" ? centered : input;
  return [mean,rms,...normalized,...centered,...output];
}
export function ropeValues(query: number, key: number, enabled: boolean) {
  const q=enabled ? query*Math.PI/4 : 0, k=enabled ? key*Math.PI/4 : 0;
  const qx=Math.cos(q), qy=Math.sin(q), kx=Math.cos(k), ky=Math.sin(k);
  return [qx,qy,kx,ky,qx*kx+qy*ky,key-query];
}
export function gqaValues(heads: number) {
  const groupSize=4/heads, mapping=[0,1,2,3].map(i=>Math.floor(i/groupSize));
  const outputs=[1,2,-1,-2].map((query,i)=>{
    const anchor=mapping[i]*groupSize, firstValue=2+2*anchor, probability=1/(1+Math.exp(-query));
    return probability*firstValue+(1-probability)*(firstValue+4);
  });
  return [4,heads,4*heads,...mapping,...outputs];
}
export function splitValues(partitions: number[]) {
  const counts=[0,1,2].map(partition=>partitions.filter(p=>p===partition).length);
  const leaks=[0,1,2].filter(i=>partitions[2*i]!==partitions[2*i+1]).length;
  return [...counts,leaks,...partitions];
}
export const curvePrediction=(x: number,curvature: number)=>x+curvature*(x*x-1);
export const scheduleRate=(step: number)=>step<=2 ? .1*step/2 : .1*Math.max(0,6-step)/4;
export function frontierMetrics(node: string,s: LabState): number[] {
  if(node==="rmsnorm") return normValues(s.feature_scale,s.feature_shift,s.norm_kind);
  if(node==="rope") return ropeValues(s.query_position,s.key_position,s.rotation_enabled);
  if(node==="gqa") return gqaValues(s.kv_heads);
  if(node==="swiglu") { const a=s.gate_input,b=s.branch_input,sigmoid=1/(1+Math.exp(-a)); return [a,sigmoid,a*sigmoid,b,a*sigmoid*b]; }
  if(node==="split") return splitValues(s.partitions);
  if(node==="leakage") { const high=s.fit_scope==="train" ? 2 : s.held_out; return [0,high,0,2/high,s.held_out/high]; }
  if(node==="overfit") {
    const train=[-1,1].map(x=>curvePrediction(x,s.curvature)), validation=[0,.5].map(x=>curvePrediction(x,s.curvature));
    const trainLoss=train.reduce((sum,p,i)=>sum+(p-[-1,1][i])**2,0)/2;
    const validationLoss=validation.reduce((sum,p,i)=>sum+(p-[0,.5][i])**2,0)/2;
    return [trainLoss,validationLoss,...train,...validation];
  }
  if(node==="schedule") return [scheduleRate(s.steps),...Array.from({length:Math.min(s.steps,6)+1},(_,i)=>scheduleRate(i))];
  throw new Error("Unknown frontier mechanism");
}
export function frontierSatisfied(node: string,stage: number,s: LabState) {
  if(node==="rmsnorm") return s.norm_kind==="rms" && s.feature_scale===(stage===1 ? 2 : 1) && s.feature_shift===(stage===2 ? 2 : 0) && (stage!==2 || s.reason==="rms-not-center");
  if(node==="rope") return s.rotation_enabled && s.query_position===[0,2,2][stage] && s.key_position===[1,3,4][stage] && (stage!==2 || s.reason==="relative-phase");
  if(node==="gqa") return s.kv_heads===[4,2,1][stage] && s.steps===1 && (stage!==2 || s.reason==="share-kv");
  if(node==="swiglu") return s.gate_input===[1,-2,1][stage] && s.branch_input===[2,2,-1][stage] && (stage!==2 || s.reason==="gated-product");
  if(node==="split") { const metrics=splitValues(s.partitions); return metrics.slice(0,3).every(n=>n===2) && (stage===0 || metrics[3]===0) && (stage!==2 || s.reason==="group-boundaries"); }
  if(node==="leakage") return s.fit_scope==="train" && (stage!==1 || s.held_out===200) && (stage!==2 || s.reason==="train-only-fit");
  if(node==="overfit") return s.curvature===(stage===1 ? 2 : 0) && (stage!==2 || s.reason==="validation-selection");
  if(node==="schedule") return s.steps===[1,2,6][stage] && (stage!==2 || s.reason==="rate-schedule");
  return false;
}
