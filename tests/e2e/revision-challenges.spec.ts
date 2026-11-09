import {test,expect,type Page,type BrowserContext} from "@playwright/test";
import {fixture,open,fill} from "./revision-fixture";

async function setup(page:Page,context:BrowserContext){
 const repair=await fixture(page,context);
 let revision=5,active:Record<string,unknown>|null=null;
 const reports:Record<string,unknown>[]=[],keys:string[]=[];
 let fail=false,stale=false;
 const origin={revision_id:"repair-1",source_attempt:"source-repair",focus:"path",graph_revision:1};
 const prompt="词表‘风’编号2、‘雨’编号0。按2、0、2逐项查表，解释实际索引并核对新命题。";
 const state=()=>({revision,goals:[],active,reports});
 await page.route("**/api/v1/relation-revisions/challenge/*",route=>route.fulfill({json:{revision_id:"repair-1",source_attempt:"source-repair",graph_revision:1,edge:{label:"token通过固定编号对应到嵌入表行",note:"词表编号与表行映射保持一致。"},focuses:[{id:"path",title:"检查推导"}],note:"挑战是修订练习，不计入候选或跳级。"}}));
 await page.route("**/api/v1/verification",route=>route.fulfill({json:state()}));
 await page.route("**/api/v1/candidates{,?*}",route=>route.fulfill({json:{items:[],total:0,next_offset:null}}));
 await page.route("**/api/v1/verification/attempts/*",route=>route.fulfill({json:reports.at(-1)}));
 await page.route("**/api/v1/verification/actions",async route=>{
  const body=route.request().postDataJSON();keys.push(body.operation_key);
  if(fail){fail=false;await route.fulfill({status:503,json:{detail:"offline"}});return;}
  if(stale){stale=false;revision++;await route.fulfill({status:409,json:{detail:"stale"}});return;}
  expect(body.base_revision).toBe(revision);
  if(body.action==="start_revision_challenge"){
   expect(body.revision_id).toBe("repair-1");expect(body.revision_focus).toBe("path");expect(body.graph_revision).toBe(1);
   active={id:"challenge-1",goal:"lookup",title:"修订挑战：检查推导",kind:"revision_challenge",prompt,options:["按编号顺序查表","按大小排序","编号当向量"],repeat_family:false,revision_origin:origin};
  }else{
   expect(body.action).toBe("submit");expect(body.attempt_id).toBe("challenge-1");
   const match=body.choice===0;
   reports.push({id:"challenge-1",title:"修订挑战：检查推导",prompt,options:active!.options,choice:body.choice,explanation:body.explanation,choice_matches:match,independence:"not_established",status:"pending_review",task_version:"fixture-v1",graph_revision:1,rationale:"参考：按2、0、2读取对应向量行。",rubric:[{id:"path",title:"查表关系",requirement:"具体推导并检查新命题"}],self_reviews:[],revision_origin:origin,target_feedback:{title:"检查推导",message:match?"本题选择符合规则，接着检查你写出的推导与命题。":"本题选择与规则不符。",explanation_status:"pending_review",gap_status:"not_established"}});
   repair.history[0].challenges=[{id:"challenge-1",title:"修订挑战：检查推导",submitted:true,choice_matches:match}];active=null;
  }
  revision++;await route.fulfill({json:state()});
 });
 await open(page);await fill(page);await page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true}).click();await page.getByText("星图v0 → v1",{exact:false}).click();await page.getByRole("button",{name:"挑战这次修订",exact:true}).click();
 await expect(page.getByRole("button",{name:"开始这次缺口挑战",exact:true})).toBeEnabled();
 return {keys,fail:()=>{fail=true;},stale:()=>{stale=true;}};
}

test("修订新情境、分开反馈、返回修订和精确回看形成闭环",async({page,context})=>{
 await setup(page,context);await expect(page.getByText("参考：",{exact:false})).toHaveCount(0);
 await page.getByRole("button",{name:"开始这次缺口挑战",exact:true}).click();await expect(page.getByText("词表‘风’编号2",{exact:false})).toBeVisible();await expect(page.getByText("参考：",{exact:false})).toHaveCount(0);
 await page.getByLabel("按编号顺序查表",{exact:true}).check();await page.getByLabel("验证解释",{exact:true}).fill("先将输入转为2、0、2，再逐项查对应表行；固定映射，不靠编号差判断语义。");await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();
 await expect(page.locator(".revision-target-feedback")).toContainText("选择符合规则");await expect(page.locator(".revision-target-feedback")).toContainText("缺口是否解决仍未知");await page.screenshot({path:".runtime/screenshots/revision-challenge-desktop.png",fullPage:true});
 await page.getByRole("button",{name:"带着反馈继续修订",exact:true}).click();await expect(page.getByRole("heading",{name:"修好这条关系",exact:true})).toBeVisible();await page.getByText("星图v0 → v1",{exact:false}).click();await page.getByRole("button",{name:"回看挑战作答",exact:true}).click();await expect(page.locator(".verification-original").last()).toContainText("先将输入转为2、0、2");
});

test("挑战503同键重试保留解释，已有情境不覆盖",async({page,context})=>{
 const f=await setup(page,context);f.fail();await page.getByRole("button",{name:"开始这次缺口挑战",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("提交未确认");await page.getByRole("button",{name:"开始这次缺口挑战",exact:true}).click();expect(f.keys.at(-1)).toBe(f.keys.at(-2));
 await expect(page.getByRole("button",{name:"开始这次缺口挑战",exact:true})).toBeDisabled();await page.getByLabel("验证解释",{exact:true}).fill("还没想清，先保留我的条件检查。");f.fail();await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();await expect(page.getByLabel("验证解释",{exact:true})).toHaveValue("还没想清，先保留我的条件检查。");await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();expect(f.keys.at(-1)).toBe(f.keys.at(-2));await expect(page.locator(".revision-target-feedback")).toContainText("解释待独立复核");
});

test("手机冲突先读最新再开始，不溢出页面",async({page,context})=>{
 await page.setViewportSize({width:390,height:844});const f=await setup(page,context);f.stale();await page.getByRole("button",{name:"开始这次缺口挑战",exact:true}).click();await expect(page.getByRole("button",{name:"开始这次缺口挑战",exact:true})).toBeDisabled();await page.getByRole("button",{name:"读取最新验证记录",exact:true}).click();await page.getByRole("button",{name:"开始这次缺口挑战",exact:true}).click();await expect(page.getByLabel("验证解释",{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:".runtime/screenshots/revision-challenge-mobile.png",fullPage:true});
});
