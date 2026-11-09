import {test,expect,type Page} from "@playwright/test";
import {expeditionFixture} from "./expedition-fixture";

async function fixture(page:Page){
  await expeditionFixture(page,"representation");
  let revision=0,active:Record<string,unknown>|null=null,next=1,fail=false,conflict=false;
  const reports:Record<string,unknown>[]=[],keys:string[]=[];
  const rubric=[{id:"path",title:"说明影响路径",requirement:"说明被排除的信息。"},{id:"conditions",title:"说清成立条件",requirement:"说明其他量保持固定。"},{id:"boundary",title:"给出有效边界",requirement:"指出规则变化时需重算。"}];
  function task(){return {id:`attempt-${next++}`,goal:"mask",title:"读取边界的新情境",prompt:"位置2只读0、1、2。只改变位置3，输出怎样？解释条件和反例。",options:["保持不变","一定增大","一定减小"],repeat_family:reports.length>0};}
  function state(){return {revision,version:"fixture",goals:[{id:"mask",title:"读取边界的新情境"}],active,reports};}
  await page.route("**/api/v1/verification",route=>route.fulfill({json:state()}));
  await page.route("**/api/v1/verification/actions",async route=>{
    const body=route.request().postDataJSON();keys.push(body.operation_key);
    if(fail){fail=false;await route.fulfill({status:503,json:{detail:"offline"}});return;}
    if(conflict){conflict=false;revision++;active=task();await route.fulfill({status:409,json:{detail:"conflict"}});return;}
    revision++;
    if(body.action==="start")active=task();
    if(body.action==="submit"){
      reports.push({...active,...body,status:"pending_review",independence:body.used_help?"supported":"not_established",choice_matches:body.choice===0,rubric,rationale:"范围外的改变不经固定读取关系影响当前位置。",graph_revision:7,task_version:"transfer-fixture",self_reviews:[]});active=null;
    }
    if(body.action==="self_review"){const report=reports.find(r=>r.id===body.attempt_id)!;(report.self_reviews as unknown[]).push({created_at:"2026-11-08T00:00:00Z",review:body.review});}
    await route.fulfill({json:state()});
  });
  return {keys,fail:()=>{fail=true;},conflict:()=>{conflict=true;}};
}
async function open(page:Page){await page.goto("/");await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"把关系讲通"}).click();await expect(page.getByRole("heading",{name:"把关系讲通",exact:true})).toBeVisible();}
async function begin(page:Page){await page.getByRole("button",{name:"读取边界的新情境",exact:true}).click();await expect(page.getByLabel("验证解释",{exact:true})).toBeVisible();}

test("先提交原文才看量规，本人复盘留痕但不授予掌握，原文与重做分开",async({page})=>{
  await fixture(page);await open(page);await begin(page);
  await expect(page.getByText("对照关系与量规，复盘自己的解释",{exact:true})).toHaveCount(0);
  await page.getByLabel("保持不变",{exact:true}).check();await page.getByLabel("验证解释").fill("可读输入和规则保持固定，范围外的改变不影响当前位置。若读取范围变化则需重算。");
  await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();
  await expect(page.locator(".verification-room")).toContainText("解释：待独立复核");
  await page.getByText("对照关系与量规，复盘自己的解释",{exact:true}).click();
  for(const title of ["说明影响路径","说清成立条件","给出有效边界"]){
    await page.getByLabel(`${title}判断`,{exact:true}).selectOption("met");await page.getByLabel(`${title}原文`,{exact:true}).fill("固定");await page.getByLabel(`${title}理由`,{exact:true}).fill("这是我的复盘判断，需要独立复核。");
  }
  await page.getByRole("button",{name:"保存本人复盘",exact:true}).click();await expect(page.locator(".verification-room")).toContainText("本人复盘不会替代独立复核");
  await page.getByText("回看已保存复盘（1次）",{exact:true}).click();await expect(page.locator(".verification-room")).toContainText("这是我的复盘判断");
  await page.screenshot({path:".runtime/screenshots/verification-review.png",fullPage:true});
  await begin(page);await expect(page.locator(".verification-room")).toContainText("同题族重做");await expect(page.locator(".verification-original").first()).toContainText("可读输入");
});

test("解释草稿刷新找回，503保留原文并复用键，提交后刷新保留结果",async({page})=>{
  const f=await fixture(page);await open(page);await begin(page);await page.getByLabel("验证解释").fill("这是尚未提交的解释，刷新后仍需保留。");
  await expect(page.getByRole("status")).toContainText("本机草稿已暂存");
  await open(page);await expect(page.getByLabel("验证解释")).toHaveValue("这是尚未提交的解释，刷新后仍需保留。");
  f.fail();await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("提交未确认");
  await expect(page.getByLabel("验证解释")).toHaveValue("这是尚未提交的解释，刷新后仍需保留。");
  await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();await expect(page.locator(".verification-room")).toContainText("解释：待独立复核");expect(f.keys.at(-1)).toBe(f.keys.at(-2));
  await open(page);await expect(page.locator(".verification-original")).toContainText("刷新后仍需保留");
});

test("390像素解释与复盘可读，409新情境不覆盖旧草稿，断线可返回",async({page})=>{
  const f=await fixture(page);await page.setViewportSize({width:390,height:844});await open(page);await begin(page);
  await page.getByLabel("验证解释").fill("这是旧情境的解释。");f.conflict();await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();
  await expect(page.getByRole("button",{name:"提交解释，留下原文",exact:true})).toBeDisabled();await page.getByRole("button",{name:"读取最新验证记录",exact:true}).click();
  await expect(page.getByLabel("验证解释")).toHaveValue("");await page.getByText("上一情境未提交的本机解释",{exact:true}).click();await expect(page.locator(".verification-original")).toContainText("这是旧情境的解释");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:".runtime/screenshots/verification-mobile.png",fullPage:true});
  await page.getByRole("button",{name:"回到群岛",exact:true}).click();await page.unroute("**/api/v1/verification");await page.route("**/api/v1/verification",route=>route.fulfill({status:503,json:{detail:"offline"}}));
  await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"把关系讲通"}).click();await expect(page.locator(".intake-error")).toContainText("暂时未连接");
  await page.getByRole("button",{name:"回到群岛",exact:true}).click();await expect(page.locator(".exploration-field")).toBeVisible();
});
