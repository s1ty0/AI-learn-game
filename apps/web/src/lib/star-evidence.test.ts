import {describe,it,expect} from "vitest";
import {badge} from "./star-evidence";

describe("只读证据徽标",()=>{
  it("缺口优先，不用候选记录掩盖其他待补",()=>{
    expect(badge({id:"x",covered:true,counts:{candidate_ready:2,needs_evidence:1}})).toBe("有待补证据");
    expect(badge({id:"x",covered:true,counts:{needs_policy_review:1}})).toBe("有待补证据");
  });
  it("区分无记录和未覆盖，不判不会",()=>{
    expect(badge({id:"x",covered:true,counts:{}})).toBe("尚无验证记录");
    expect(badge({id:"x",covered:false,counts:{}})).toBe("验证覆盖待补");expect(badge(undefined)).toBe("");
  });
  it("可复验先于等待，候选仍明确未认证",()=>{
    expect(badge({id:"x",covered:true,counts:{ready_for_recheck:1,waiting_interval:1}})).toBe("有可做复验");
    expect(badge({id:"x",covered:true,counts:{candidate_ready:1}})).toBe("有候选记录 · 未认证");
  });
});
