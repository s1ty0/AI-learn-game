import { describe, expect, it } from "vitest";
import { initialLab, labMetrics, labSatisfied } from "./expedition";
import { gqaValues, normValues, ropeValues, scheduleRate, splitValues } from "./frontier";

describe("现代结构与评估边界的独立参照",()=>{
  it("RMSNorm不强制零均值，平移不同于LayerNorm，缩放因ε仅近似不变",()=>{
    const base=normValues(1,0,'rms'), scaled=normValues(2,0,'rms'), shifted=normValues(1,2,'rms');
    expect(base[2]).toBeCloseTo(1/Math.sqrt(2.5+1e-5),12);
    expect((base[2]+base[3])/2).toBeGreaterThan(.9);
    expect(Math.abs(base[2]-scaled[2])).toBeLessThan(2e-6);
    expect(shifted[2]).not.toBeCloseTo(base[2],3);
    expect(shifted[4]).toBeCloseTo(base[4],12);
  });
  it("二维旋转保范数，共同平移保点积，单频并非随距离单调衰减",()=>{
    for(let m=0;m<=4;m++){
      const v=ropeValues(m,m+1,true);
      expect(Math.hypot(v[0],v[1])).toBeCloseTo(1,12);
      expect(Math.hypot(v[2],v[3])).toBeCloseTo(1,12);
      expect(v[4]).toBeCloseTo(Math.SQRT1_2,12);
    }
    expect(ropeValues(0,4,true)[4]).toBeCloseTo(-1,12);
    expect(ropeValues(0,6,true)[4]).toBeGreaterThan(ropeValues(0,4,true)[4]);
  });
  it("共享减少K/V标量而保留四个查询，并可能改变输出",()=>{
    const full=gqaValues(4), grouped=gqaValues(2), shared=gqaValues(1);
    expect(full.slice(0,3)).toEqual([4,4,16]);expect(grouped.slice(0,3)).toEqual([4,2,8]);expect(shared.slice(0,3)).toEqual([4,1,4]);
    expect(grouped.slice(3,7)).toEqual([0,0,1,1]);expect(shared.slice(3,7)).toEqual([0,0,0,0]);
    expect(grouped[8]).not.toBeCloseTo(full[8],5);
    expect(full[7]).toBeCloseTo(2+4/(1+Math.E),12);
  });
  it("SiLU门分支可为负，整体输出还受另一分支影响",()=>{
    const s={...initialLab('swiglu',1),gate_input:-2,branch_input:2};
    expect(labMetrics('swiglu',1,s)[4]).toBeCloseTo(-4/(1+Math.exp(2)),12);
    expect(labMetrics('swiglu',2,{...s,gate_input:1,branch_input:-1})[4]).toBeCloseTo(-1/(1+Math.exp(-1)),12);
  });
  it("每区数量相同不能消除相关用户泄漏，训练拟合的刻度不随验证变化",()=>{
    const leaky=[0,1,0,2,1,2]; expect(splitValues(leaky).slice(0,4)).toEqual([2,2,2,3]);
    expect(labSatisfied('split',1,{...initialLab('split',1),partitions:leaky})).toBe(false);
    expect(labSatisfied('split',1,{...initialLab('split',1),partitions:[2,2,0,0,1,1]})).toBe(true);
    const clean={...initialLab('leakage',0),fit_scope:'train' as const};
    expect(labMetrics('leakage',0,clean)).toEqual([0,2,0,1,50]);
    expect(labMetrics('leakage',1,{...clean,held_out:200})).toEqual([0,2,0,1,100]);
  });
  it("训练零误差候选仍有不同验证误差，调度按明确位置达到峰值和终点",()=>{
    for(const c of [0,.5,1,1.5,2]){const metrics=labMetrics('overfit',0,{...initialLab('overfit',0),curvature:c});expect(metrics[0]).toBe(0);expect(metrics[1]).toBeCloseTo(.78125*c*c,12);}
    const expected=[0,.05,.1,.075,.05,.025,0];
    expected.forEach((rate,i)=>expect(scheduleRate(i)).toBeCloseTo(rate,12));
  });
});
