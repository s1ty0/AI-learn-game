import {test,expect,type Page} from "@playwright/test";
import {expeditionFixture} from "./expedition-fixture";

async function fixture(page:Page){
  await expeditionFixture(page,"representation");
  let revision=0,own=false,fail=false,conflict=false,authorized=true;
  const keys:string[]=[],history:Record<string,unknown>[]=[];
  const rubric=[{id:"path",title:"说明影响路径",requirement:"解释读取范围。"},{id:"conditions",title:"说清成立条件",requirement:"其他条件保持固定。"},{id:"boundary",title:"给出有效边界",requirement:"说明规则变化时重新计算。"}];
  function detail(){return {id:"attempt-1",title:"读取边界的新情境",prompt:"只改变读取范围外的值，如何影响结果？",options:["不变","增大","减小"],choice:0,choice_matches:true,explanation:"固定其他输入和规则，范围外的变化不影响当前位置。若改变读取范围，需要重新判断。",independence:"not_established",task_version:"fixture-version",graph_revision:7,revision,rubric,rationale:"需核查读取路径和固定条件。",own_latest:own?history.at(-1):null,peers_hidden:!own,review_state:{revision,status:own?"single_review":"awaiting_your_review",reviewer_count:own?1:0,disagreements:[],history:own?history:[],mastery:"unverified"}};}
  await page.route("**/api/v1/reviewing{,/**,?*}",async route=>{
    const req=route.request(),url=new URL(req.url());
    if(!authorized||req.headers().authorization!=="Bearer fixture-access"){await route.fulfill({status:401,json:{detail:"访问钥匙无效或已停用。"}});return;}
    if(url.pathname.endsWith("/me")){await route.fulfill({json:{id:"reviewer-a",name:"测试复核者"}});return;}
    if(!url.pathname.endsWith("attempt-1")){await route.fulfill({json:{items:[{id:"attempt-1",title:"读取边界的新情境",created_at:"2026-11-09T00:00:00Z",reviewer_count:own?1:0,has_own_review:own}],total:1,next_offset:null}});return;}
    if(req.method()==="POST"){
      const body=req.postDataJSON();keys.push(body.operation_key);
      if(fail){fail=false;await route.fulfill({status:503,json:{detail:"保存未确认，草稿保留。"}});return;}
      if(conflict){conflict=false;revision++;await route.fulfill({status:409,json:{detail:"stale"}});return;}
      revision++;own=true;history.push({id:`review-${revision}`,actor:"reviewer-a",actor_name:"测试复核者",created_at:"2026-11-09T00:00:00Z",items:body.items,correction_reason:body.correction_reason,supersedes:body.supersedes,observation:body.observation});
    }
    await route.fulfill({json:detail()});
  });
  return {keys,fail:()=>{fail=true;},conflict:()=>{conflict=true;},revoke:()=>{authorized=false;}};
}
async function open(page:Page){await page.goto("/");await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"复核工作台"}).click();await expect(page.getByRole("heading",{name:"复核工作台",exact:true})).toBeVisible();}
async function login(page:Page,key="fixture-access"){await page.getByLabel("复核访问钥匙").fill(key);await page.getByRole("button",{name:"验证身份并进入队列",exact:true}).click();}
async function select(page:Page){await page.getByRole("button").filter({hasText:"读取边界的新情境"}).click();await expect(page.getByLabel("复核说明影响路径判断")).toBeVisible();}
async function fill(page:Page){for(const title of ["说明影响路径","说清成立条件","给出有效边界"]){await page.getByLabel(`复核${title}判断`).selectOption("met");await page.getByLabel(`复核${title}原文`).fill("固定");await page.getByLabel(`复核${title}理由`).fill("根据题设和这段原文，仍需结合上下文核查。");}}

test("访问身份控制队列，逐项复核、追加纠正和旧意见都可回看",async({page})=>{
  await fixture(page);await open(page);await login(page,"wrong");await expect(page.locator(".intake-error")).toContainText("访问钥匙无效");
  await login(page);await expect(page.locator(".verification-room")).toContainText("当前身份：测试复核者");
  await select(page);await expect(page.locator(".verification-room")).toContainText("不展示他人的逐项意见");await fill(page);
  await page.getByLabel("独立性观察判断").selectOption("observed_no_help");await page.getByLabel("独立性观察依据").fill("现场观察了作答过程，没有提供资料、答案或线索。");
  await page.getByRole("button",{name:"提交本人的逐项复核",exact:true}).click();await expect(page.locator(".verification-room")).toContainText("已有一位复核者");
  await expect(page.getByRole("button").filter({hasText:"读取边界的新情境"})).toContainText("我已复核");
  await expect(page.getByRole("button").filter({hasText:"读取边界的新情境"})).toContainText("1位复核者");
  await page.getByLabel("复核纠正原因").fill("重新核对条件后明确边界，保留原判断。");await page.getByRole("button",{name:"追加纠正并保留旧意见",exact:true}).click();
  await page.getByText("回看复核历史与逐项依据",{exact:true}).click();await expect(page.locator(".verification-room")).toContainText("重新核对条件后明确边界");
  await expect(page.locator(".verification-room")).toContainText("现场观察了作答过程");
  await page.screenshot({path:".runtime/screenshots/review-board-desktop.png",fullPage:true});
  await page.getByRole("button",{name:"退出复核身份",exact:true}).click();await expect(page.getByLabel("复核访问钥匙")).toHaveValue("");
});

test("503保留逐项草稿和操作键，409重读后不自动提交",async({page})=>{
  const f=await fixture(page);await open(page);await login(page);await select(page);await fill(page);
  f.fail();await page.getByRole("button",{name:"提交本人的逐项复核",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("保存未确认");
  await expect(page.getByLabel("复核说明影响路径理由")).toHaveValue("根据题设和这段原文，仍需结合上下文核查。");
  await page.getByRole("button",{name:"提交本人的逐项复核",exact:true}).click();await expect(page.locator(".verification-room")).toContainText("已有一位复核者");expect(f.keys.at(-1)).toBe(f.keys.at(-2));
  await page.getByLabel("复核纠正原因").fill("再次核对后补充判断。");f.conflict();await page.getByRole("button",{name:"追加纠正并保留旧意见",exact:true}).click();
  await expect(page.getByRole("button",{name:"追加纠正并保留旧意见",exact:true})).toBeDisabled();await page.getByRole("button",{name:"读取最新复核",exact:true}).click();
  await expect(page.getByLabel("复核纠正原因")).toHaveValue("再次核对后补充判断。");await expect(page.locator(".verification-room")).toContainText("不会自动合并");
});

test("手机复核可读，停用钥匙拒绝刷新，刷新页面不记住访问钥匙",async({page})=>{
  const f=await fixture(page);await page.setViewportSize({width:390,height:844});await open(page);await login(page);await select(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:".runtime/screenshots/review-board-mobile.png",fullPage:true});
  f.revoke();await page.getByRole("button",{name:"刷新复核队列",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("访问钥匙无效或已停用");
  await open(page);await expect(page.getByLabel("复核访问钥匙")).toHaveValue("");
  expect(await page.evaluate(()=>Object.values(localStorage).every(value=>!String(value).includes("fixture-access")))).toBe(true);
});
