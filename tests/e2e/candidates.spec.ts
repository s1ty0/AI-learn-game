import {test,expect,type Page} from "@playwright/test";
import {expeditionFixture} from "./expedition-fixture";

async function fixture(page:Page,initial="ready_for_recheck"){
  await expeditionFixture(page,"representation");
  let status=initial,revision=4,parentRevision=7,active:Record<string,unknown>|null=null,fail=false,conflict=false,offline=false;
  const keys:string[]=[];
  const rubric=[{id:"path",title:"说明影响路径",requirement:"解释关系。"},{id:"conditions",title:"说清成立条件",requirement:"说明固定条件。"},{id:"boundary",title:"给出有效边界",requirement:"说明边界。"}];
  const reports:Record<string,unknown>[]=[{id:"source-1",title:"读取边界的初次验证",prompt:"解释原读取关系。",options:["不变","变大","变小"],choice:0,explanation:"原来的独立解释与边界。",used_help:false,choice_matches:true,independence:"not_established",status:"pending_review",rubric,rationale:"按固定范围判断。",task_version:"transfer-fixture",graph_revision:4,self_reviews:[]}];
  const checks=[{id:"prediction",ok:true,label:"本题判断符合规则"},{id:"reviewers",ok:true,label:"两个配置身份复核"},{id:"observation",ok:true,label:"有观察依据且无冲突"}];
  function state(){return {revision,goals:[{id:"mask",title:"读取边界的新情境"}],active,reports};}
  await page.route("**/api/v1/candidates",route=>offline?route.fulfill({status:503,json:{detail:"offline"}}):route.fulfill({json:{policy:"candidate-fixture-72h",interval_hours:72,server_time:"2026-11-12T00:00:00Z",items:[{id:"source-1",title:"读取边界的初次验证",status,reason:status==="needs_evidence"?"独立性尚无观察依据。":status==="waiting_interval"?"按服务器时间等待72小时。":status==="candidate_ready"?"仅形成候选，不自动解锁。":"复验与初次条件分别检查。",due_at:"2026-11-12T00:00:00Z",initial:{eligible:status!=="needs_evidence",review_revision:parentRevision,checks:checks.map(c=>({...c,ok:c.id!=="observation"||status!=="needs_evidence"}))},recheck:status==="recheck_needs_evidence"?{eligible:false,checks:[{id:"reviewers",ok:false,label:"复验还需逐项复核"}]}:null,active_recheck:active?.kind==="recheck"?active.id:null,mastery:"unverified"}]}}));
  await page.route("**/api/v1/verification",route=>route.fulfill({json:state()}));
  await page.route("**/api/v1/verification/actions",async route=>{
    const body=route.request().postDataJSON();keys.push(body.operation_key);
    if(conflict){conflict=false;parentRevision++;await route.fulfill({status:409,json:{detail:"来源复核已变化"}});return;}
    if(fail){fail=false;await route.fulfill({status:503,json:{detail:"offline"}});return;}
    revision++;
    if(body.action==="start_recheck"){
      expect(body.parent_attempt).toBe("source-1");expect(body.parent_review_revision).toBe(parentRevision);
      active={id:"recheck-1",goal:"mask",title:"读取规则变化后的复验",prompt:"规则改为允许读取第三个值，输出怎样变化？",options:["从4变为6","仍为4","从6变为4"],repeat_family:false,kind:"recheck"};status="recheck_in_progress";
    }
    if(body.action==="submit"){reports.push({...active,...body,id:"recheck-1",status:"pending_review",choice_matches:true,independence:"not_established",rubric,rationale:"读取范围改变后需重算。",task_version:"recheck-fixture",graph_revision:4,self_reviews:[],kind:"recheck",parent_attempt:"source-1"});active=null;status="recheck_needs_evidence";}
    await route.fulfill({json:state()});
  });
  return {keys,status:(next:string)=>{status=next;},conflict:()=>{conflict=true;},fail:()=>{fail=true;},offline:()=>{offline=true;}};
}
async function open(page:Page){await page.goto("/");await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"把关系讲通"}).click();await expect(page.getByRole("heading",{name:"候选证据与延后复验",exact:true})).toBeVisible();}
async function expand(page:Page){await page.locator(".candidate-evidence summary").click();}

test("缺口、等待、到期和复验分别呈现，不把一致意见当掌握",async({page})=>{
  const f=await fixture(page,"needs_evidence");await open(page);await expand(page);await expect(page.locator(".candidate-evidence")).toContainText("待补齐：有观察依据且无冲突");
  await expect(page.getByRole("button",{name:"开始这次延后复验",exact:true})).toHaveCount(0);
  f.status("waiting_interval");await page.getByRole("button",{name:"刷新候选证据",exact:true}).click();await expect(page.locator(".candidate-evidence")).toContainText("等待延后复验");
  f.status("ready_for_recheck");await page.getByRole("button",{name:"刷新候选证据",exact:true}).click();await page.getByRole("button",{name:"开始这次延后复验",exact:true}).click();
  await expect(page.getByLabel("验证解释")).toBeVisible();await expect(page.locator(".verification-room")).toContainText("延后复验：先尝试新关系");
  await page.getByLabel("从4变为6",{exact:true}).check();await page.getByLabel("验证解释").fill("规则改变后，固定输入下需重新计算，不能沿用原来的不变结论。");
  await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();await expect(page.locator(".candidate-evidence")).toContainText("复验证据待补齐");
  f.status("candidate_ready");await page.getByRole("button",{name:"刷新候选证据",exact:true}).click();await expect(page.locator(".candidate-evidence")).toContainText("候选线索齐备，仍未认证掌握");
  await page.screenshot({path:".runtime/screenshots/candidate-evidence-desktop.png",fullPage:true});
});

test("来源复核变化重读后刷新候选版本，503重试复用同一键",async({page})=>{
  const f=await fixture(page);await open(page);await expand(page);f.conflict();await page.getByRole("button",{name:"开始这次延后复验",exact:true}).click();
  await expect(page.locator(".intake-error")).toContainText("验证记录已更新");await page.getByRole("button",{name:"读取最新验证记录",exact:true}).click();
  f.fail();await page.getByRole("button",{name:"开始这次延后复验",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("提交未确认");
  await page.getByRole("button",{name:"开始这次延后复验",exact:true}).click();await expect(page.getByLabel("验证解释")).toBeVisible();expect(f.keys.at(-1)).toBe(f.keys.at(-2));
});

test("手机候选条件可读，证据读取故障不冻结验证和返回",async({page})=>{
  const f=await fixture(page);await page.setViewportSize({width:390,height:844});await open(page);await expand(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:".runtime/screenshots/candidate-evidence-mobile.png",fullPage:true});
  f.offline();await page.getByRole("button",{name:"刷新候选证据",exact:true}).click();await expect(page.locator(".candidate-evidence .intake-error")).toContainText("不影响原验证作答");
  await expect(page.getByRole("button",{name:"读取边界的新情境",exact:true})).toBeEnabled();await page.getByRole("button",{name:"回到群岛",exact:true}).click();await expect(page.locator(".exploration-field")).toBeVisible();
});
