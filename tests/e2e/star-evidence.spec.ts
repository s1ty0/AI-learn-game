import {test,expect,type Page,type BrowserContext} from "@playwright/test";
import {expeditionFixture} from "./expedition-fixture";
import {workbenchFixture} from "./workbench-fixture";
import type {Snapshot} from "../../apps/web/src/lib/api";

const seed:Snapshot={revision:0,release_id:"fixture",created_at:"2026-11-09T00:00:00Z",restored_from:null,note:"旧图",payload:{nodes:[
  {id:"entity-0144",type:"knowledge",position:{x:0,y:0},data:{label:"token",subtitle:"旧解释",category:"custom",note:"原有个人解释"}},
  {id:"entity-0073",type:"knowledge",position:{x:250,y:0},data:{label:"词嵌入",subtitle:"旧解释",category:"custom",note:"嵌入的原解释"}},
],edges:[{id:"own-edge",source:"entity-0144",target:"entity-0073",label:"我的查表连接"}]}};
async function fixture(page:Page,context:BrowserContext){
  const graph=await workbenchFixture(context,structuredClone(seed));await expeditionFixture(page,"representation");
  await page.route("**/api/v1/discoveries",route=>route.fulfill({json:{release_id:"current",status:"draft",mastery:"unverified",chapters:[{id:"representation",title:"表征工坊"}],entities:[{id:"entity-0144",name:"token",chapters:["representation"],origins:[]},{id:"entity-0073",name:"词嵌入",chapters:["representation"],origins:[]}],relations:[]}}));
  let fail=false,detailFail=false,goalFail=false,status="ready_for_recheck";
  const item={id:"old-source",goal:"lookup",title:"很早的换表验证",reason:"先检查这次来源的证据，再安排复验。",due_at:"2026-11-09T00:00:00Z",initial:{review_revision:7,checks:[{id:"criteria",ok:false,label:"逐项解释复核"}]},recheck:null,active_recheck:null,recheck_attempt:null,mastery:"unverified"};
  await page.route("**/api/v1/star-evidence{,/**,?*}",async route=>{
    if(fail){await route.fulfill({status:503,json:{detail:"offline"}});return;}
    const url=new URL(route.request().url());
    if(url.pathname.endsWith("star-evidence")){await route.fulfill({json:{scope:"current_evidence",entities:seed.payload.nodes.map(n=>({id:n.id,covered:true,counts:{[status]:1}}))}});return;}
    await route.fulfill({json:{entity_id:url.pathname.split("/").at(-1),goals:[{id:"lookup",title:"换表后的表示",available:true,bridge:"编号用于查表，不表示语义距离。"}],items:[{...item,status}],next_offset:null,total:1}});
  });
  const report={id:"old-source",title:"很早的换表验证",prompt:"旧任务：换表后应该如何查向量？",options:["第一种","第二种","第三种"],choice:1,explanation:"旧作答原文只从精确历史入口读取。",used_help:false,choice_matches:true,independence:"not_established",status:"pending_review",rubric:[],rationale:"旧题参考",task_version:"old-version",graph_revision:0,self_reviews:[]};
  await page.route("**/api/v1/verification",route=>route.fulfill({json:{revision:8,goals:[{id:"lookup",title:"换表后的表示"}],active:null,reports:[]}}));
  await page.route("**/api/v1/verification/attempts/*",route=>detailFail?route.fulfill({status:503,json:{detail:"offline"}}):route.fulfill({json:report}));
  await page.route("**/api/v1/candidates{,?*}",route=>route.fulfill({json:{policy:"fixture",interval_hours:72,server_time:"2026-11-09T00:00:00Z",items:[{...item,status}],total:1,next_offset:null}}));
  await page.route("**/api/v1/verification/actions",async route=>{
    const body=route.request().postDataJSON();expect(body.action).toBe("start_recheck");expect(body.parent_attempt).toBe("old-source");expect(body.parent_review_revision).toBe(7);
    if(goalFail){await route.fulfill({status:409,json:{detail:"stale"}});return;}
    await route.fulfill({json:{revision:9,goals:[],reports:[],active:{id:"recheck-new",title:"同步重排后的表示复验",goal:"lookup",prompt:"同步重排后向量是否保持？",options:["保持","改变","未知"],kind:"recheck",repeat_family:false}}});
  });
  return {graph,fail:()=>{fail=true;},recover:()=>{fail=false;},detailFail:()=>{detailFail=true;},change:(value:string)=>{status=value;}};
}
async function open(page:Page){await page.goto("/");await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"我的星图"}).click();await expect(page.locator(".star-map-top>span")).toContainText("已保存");}
async function focus(page:Page){await page.getByLabel("选择星图知识点",{exact:true}).selectOption("entity-0073");await expect(page.locator(".star-evidence-panel")).toContainText("这颗星的当前证据");}

test("星图显示状态，历史作答精确跳转，未保存解释返回可找回",async({page,context})=>{
  const f=await fixture(page,context);await open(page);await expect(page.locator(".star-evidence-badge").first()).toContainText("可做复验");await focus(page);
  await page.getByLabel("星图里的我的解释").fill("这是从证据入口离开前尚未提交的新理解。");
  await page.locator(".star-evidence-panel summary").filter({hasText:"很早的换表验证"}).click();await page.getByRole("button",{name:"回看这次作答与复核",exact:true}).click();
  await expect(page.locator(".verification-original")).toContainText("旧作答原文只从精确历史入口读取");await expect(page.getByLabel("选择验证记录")).toHaveValue("old-source");
  await page.getByRole("button",{name:"回到我的星图",exact:true}).click();await expect(page.locator(".star-recovery")).toContainText("未同步草稿");
  await page.getByRole("button",{name:"找回星图草稿",exact:true}).click();await focus(page);await expect(page.getByLabel("星图里的我的解释")).toHaveValue("这是从证据入口离开前尚未提交的新理解。");
  expect(f.graph.current().revision).toBe(0);expect(f.graph.current().payload).toEqual(seed.payload);
});

test("局部补桥、复验入口和边的两端证据不冒充关系通过",async({page,context})=>{
  const f=await fixture(page,context);await open(page);await page.getByLabel("选择星图连接").selectOption("own-edge");await expect(page.locator(".star-evidence-edge-note")).toContainText("不会自动认证这条线");
  await page.getByRole("button",{name:"查看词嵌入的证据",exact:true}).click();await page.locator(".star-evidence-panel summary").filter({hasText:"局部补桥"}).click();await expect(page.locator(".star-evidence-panel")).toContainText("编号用于查表");
  await page.getByRole("button",{name:"前往对应验证目标",exact:true}).click();await expect(page.locator(".verification-target")).toContainText("换表后的表示");await page.getByRole("button",{name:"回到我的星图",exact:true}).click();await focus(page);
  await page.locator(".star-evidence-panel summary").filter({hasText:"很早的换表验证"}).click();await page.getByRole("button",{name:"前往验证室做这次复验",exact:true}).click();
  await page.locator(".candidate-evidence summary").click();await page.getByRole("button",{name:"开始这次延后复验",exact:true}).click();await expect(page.locator(".verification-room")).toContainText("同步重排后的表示复验");expect(f.graph.current().revision).toBe(0);
});

test("旧图当前证据明确区分，手机故障时编辑和保存仍可用",async({page,context})=>{
  const f=await fixture(page,context);await page.setViewportSize({width:390,height:844});await open(page);await focus(page);
  f.change("candidate_ready");await page.getByRole("button",{name:"刷新这颗星的证据",exact:true}).click();await expect(page.locator(".star-evidence-panel")).toContainText("候选齐备，未认证");
  await page.getByRole("button",{name:"历史版本",exact:true}).click();await page.locator(".star-history>button").first().click();await page.getByRole("button",{name:"我的理解",exact:true}).click();await focus(page);await expect(page.locator(".star-evidence-panel")).toContainText("不代表旧版本当时");
  await page.screenshot({path:".runtime/screenshots/star-evidence-mobile.png",fullPage:true});
  await page.getByRole("button",{name:"回到当前星图",exact:true}).click();f.fail();await page.getByRole("button",{name:"刷新这颗星的证据",exact:true}).click();await expect(page.locator(".star-evidence-panel")).toContainText("解释编辑与星图保存仍可继续");
  await page.getByLabel("星图里的我的解释").fill("证据接口故障时仍然保留我的编辑。");await page.getByRole("button",{name:"保存星图",exact:true}).click();await expect(page.locator(".star-map-top>span")).toContainText("v1");expect(f.graph.current().payload.nodes[1].data.note).toBe("证据接口故障时仍然保留我的编辑。");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("精确历史读取失败不展示另一份记录冒充目标",async({page,context})=>{
  const f=await fixture(page,context);await open(page);await focus(page);await page.locator(".star-evidence-panel summary").filter({hasText:"很早的换表验证"}).click();f.detailFail();await page.getByRole("button",{name:"回看这次作答与复核",exact:true}).click();
  await expect(page.locator(".intake-error")).toContainText("不会自动改为其他记录");await expect(page.locator(".verification-original")).toHaveCount(0);await page.getByRole("button",{name:"回到我的星图",exact:true}).click();await expect(page.getByRole("heading",{name:"我的星图",exact:true})).toBeVisible();
});
