import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { expeditionFixture } from "./expedition-fixture";
import { workbenchFixture } from "./workbench-fixture";
import type { Snapshot } from "../../apps/web/src/lib/api";
import type { Discoveries } from "../../apps/web/src/lib/star-map";

const seed: Snapshot = { revision:0,release_id:"old-release",created_at:"2026-11-08T00:00:00Z",restored_from:null,note:"原始图谱",payload:{nodes:[
  {id:"entity-0144",type:"knowledge",position:{x:0,y:0},data:{label:"token",subtitle:"原有知识",category:"input",note:"我的原解释，不可被覆盖"}},
  {id:"entity-0068",type:"knowledge",position:{x:250,y:0},data:{label:"因果掩码",subtitle:"原有知识",category:"focus",note:""}},
  {id:"entity-0065",type:"knowledge",position:{x:0,y:200},data:{label:"暂未发现的旧图节点",subtitle:"隐藏旧记录",category:"model",note:"隐藏原文必须保留"}},
],edges:[{id:"legacy",source:"entity-0144",target:"entity-0065",label:"原有隐藏连接"}]}};
const known: Discoveries={release_id:"current",status:"draft",mastery:"unverified",chapters:[{id:"information-sea",title:"信息之海"},{id:"representation",title:"表征工坊"}],entities:[
  {id:"entity-0068",name:"因果掩码",chapters:["information-sea"],origins:[{node_id:"mask",title:"回声小岛",chapter:"information-sea",release_id:"first-release",completed_at:"2026-11-08T00:00:00Z",hint_used:true}]},
  {id:"entity-0142",name:"Softmax",chapters:["information-sea"],origins:[]},
  {id:"entity-0144",name:"token",chapters:["representation"],origins:[{node_id:"token",title:"碎词码头",chapter:"representation",release_id:"token-release",completed_at:null,hint_used:false}]},
  {id:"entity-0073",name:"词嵌入",chapters:["representation"],origins:[{node_id:"embedding",title:"向量仓库",chapter:"representation",release_id:"embedding-release",completed_at:null,hint_used:false}]},
],relations:[{id:"relation-0018",source:"entity-0144",target:"entity-0073",statement:"token按编号查找嵌入表示",conditions:"固定词表与嵌入表，不把编号差当语义距离",review_status:"proposed",source_ids:["source-025"],release_id:"current"}]};

async function setup(page: Page, context: BrowserContext, discoveries=known) {
  await page.route("**/api/v1/star-evidence{,/**}",route=>route.fulfill({json:{entities:[],entity_id:"fixture",goals:[],items:[],next_offset:null,total:0}}));
  const graph=await workbenchFixture(context,structuredClone(seed));
  await context.route("**/api/v1/discoveries",route=>route.fulfill({json:discoveries}));
  await voyage(page);return graph;
}
async function voyage(page: Page) { const f=await expeditionFixture(page,"representation");f.stages.token=f.stages.embedding=3; }
async function openStars(page: Page) {
  await page.goto("/");await page.getByRole("button",{name:"更多",exact:true}).click();
  await page.getByRole("button").filter({hasText:"我的星图"}).click();
  await expect(page.getByRole("heading",{name:"我的星图",exact:true})).toBeVisible();
  await expect(page.locator(".star-map-top>span")).toContainText("已保存");
}

test("发现进入星图，个人解释和关系条件可保存、回看差异、恢复为新版本",async({page,context})=>{
  const store=await setup(page,context);await openStars(page);
  await expect(page.locator(".personal-star")).toHaveCount(1);
  await expect(page.getByText("暂未发现的旧图节点",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"接入本章发现",exact:true}).click();
  await expect(page.locator(".personal-star")).toHaveCount(2);
  await page.getByLabel("选择星图知识点",{exact:true}).selectOption("entity-0144");
  await expect(page.getByLabel("星图里的我的解释",{exact:true})).toHaveValue("我的原解释，不可被覆盖");
  await page.getByLabel("星图里的我的解释",{exact:true}).fill("同一词表里，token通过编号找到嵌入表中的表示。");
  await page.getByRole("button",{name:"关系线索",exact:true}).click();
  await expect(page.locator(".star-suggestions")).toContainText("不把编号差当语义距离");
  await page.getByRole("button",{name:"试着接上",exact:true}).click();
  await page.getByLabel("星图关系的理由与条件",{exact:true}).fill("编号是地址；固定表中查到向量，编号差不代表语义差。");
  await page.screenshot({path:".runtime/screenshots/star-map-connected.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"保存星图",exact:true}).click();
  await expect(page.locator(".star-map-top>span")).toContainText("v1");
  expect(store.current().payload.nodes.find(n=>n.id==="entity-0065")).toEqual(seed.payload.nodes[2]);
  expect(store.current().payload.edges.find(e=>e.id==="legacy")).toEqual(seed.payload.edges[0]);
  await page.getByRole("button",{name:"历史版本",exact:true}).click();
  await page.locator(".star-history>button").filter({hasText:"v0"}).click();
  await expect(page.locator(".star-history-banner")).toContainText("v0");
  await expect(page.locator(".star-difference")).toContainText("新增知识：词嵌入");
  await expect(page.locator(".star-difference")).toContainText("新增连接");
  await page.screenshot({path:".runtime/screenshots/star-map-history.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"恢复所看版本为新版本",exact:true}).click();
  await expect(page.locator(".star-map-top>span")).toContainText("v2");
  expect(store.current().payload).toEqual(seed.payload);
  await page.locator(".star-history>button").filter({hasText:"v1"}).click();
  await page.getByRole("button",{name:"我的理解",exact:true}).click();
  await page.getByLabel("选择星图连接",{exact:true}).selectOption("suggested:relation-0018");
  await expect(page.getByLabel("星图关系的理由与条件",{exact:true})).toHaveValue("编号是地址；固定表中查到向量，编号差不代表语义差。");
  await expect(page.getByLabel("星图关系的理由与条件",{exact:true})).toBeDisabled();
});

test("星图本机草稿刷新可找回，保存失败不丢字且重试复用操作键",async({page,context})=>{
  await setup(page,context);await openStars(page);
  await page.getByLabel("选择星图知识点",{exact:true}).selectOption("entity-0144");
  await page.getByLabel("星图里的我的解释",{exact:true}).fill("这是刷新前尚未保存的星图解释。");
  page.once("dialog",dialog=>dialog.accept());await page.reload();
  await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"我的星图"}).click();
  await expect(page.locator(".star-recovery")).toContainText("未同步草稿");
  await page.getByRole("button",{name:"找回星图草稿",exact:true}).click();
  await page.getByLabel("选择星图知识点",{exact:true}).selectOption("entity-0144");
  await expect(page.getByLabel("星图里的我的解释",{exact:true})).toHaveValue("这是刷新前尚未保存的星图解释。");
  const keys:string[]=[];let failed=false;
  await page.route("**/api/v1/learner-graph/operations",async route=>{
    keys.push(route.request().postDataJSON().operation_key);
    if(!failed){failed=true;await route.fulfill({status:503,json:{detail:"retry"}});}else await route.fallback();
  });
  await page.getByRole("button",{name:"保存星图",exact:true}).click();
  await expect(page.locator(".star-map-error")).toContainText("还没保存成功");
  await expect(page.getByLabel("星图里的我的解释",{exact:true})).toHaveValue("这是刷新前尚未保存的星图解释。");
  await page.getByRole("button",{name:"保存星图",exact:true}).click();
  await expect(page.locator(".star-map-top>span")).toContainText("v1");expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
});

test("两个窗口冲突保留草稿，比较后显式复制，不自动覆盖服务器",async({page,context})=>{
  const store=await setup(page,context),second=await context.newPage();await voyage(second);
  await openStars(page);await openStars(second);
  for(const current of [page,second])await current.getByLabel("选择星图知识点",{exact:true}).selectOption("entity-0144");
  await page.getByLabel("星图里的我的解释",{exact:true}).fill("第一个窗口的理解。");
  await second.getByLabel("星图里的我的解释",{exact:true}).fill("第二个窗口等待处理的草稿。");
  await page.getByRole("button",{name:"保存星图",exact:true}).click();await expect(page.locator(".star-map-top>span")).toContainText("v1");
  await second.getByRole("button",{name:"保存星图",exact:true}).click();
  await expect(second.locator(".star-map-error")).toContainText("另一处更新");
  await expect(second.getByLabel("星图里的我的解释",{exact:true})).toHaveValue("第二个窗口等待处理的草稿。");
  expect(store.current().payload.nodes[0].data.note).toBe("第一个窗口的理解。");
  await second.getByRole("button",{name:"查看最新版本",exact:true}).click();
  await expect(second.locator(".star-recovery")).toContainText("服务器已有更新");
  await second.getByText("比较草稿与服务器",{exact:true}).click();
  await expect(second.locator(".star-recovery")).toContainText("修改理解");
  await second.locator(".star-recovery").getByText("查看原文与修改",{exact:true}).click();
  await expect(second.locator(".star-recovery pre").first()).toContainText("第一个窗口的理解。");
  await expect(second.locator(".star-recovery pre").last()).toContainText("第二个窗口等待处理的草稿。");
  await second.getByRole("button",{name:"把草稿完整复制到当前修订",exact:true}).click();
  await second.getByRole("button",{name:"保存星图",exact:true}).click();
  await expect(second.locator(".star-map-top>span")).toContainText("v2");
  expect(store.current().payload.nodes[0].data.note).toBe("第二个窗口等待处理的草稿。");
  await second.close();
});

test("窄屏可用选择框接关系，未发现时保持空图，连接故障可返回",async({page,context})=>{
  await setup(page,context);await page.setViewportSize({width:390,height:844});await openStars(page);
  await page.getByRole("button",{name:"接入本章发现",exact:true}).click();
  await page.getByText("连接两个发现",{exact:true}).click();
  await page.getByLabel("连接起点",{exact:true}).selectOption("entity-0144");
  await page.getByLabel("连接终点",{exact:true}).selectOption("entity-0073");
  await page.getByLabel("新连接含义",{exact:true}).fill("按编号查表");
  await page.getByRole("button",{name:"接上这条关系",exact:true}).click();
  await expect(page.getByLabel("星图关系名称",{exact:true})).toHaveValue("按编号查表");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:".runtime/screenshots/star-map-mobile.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"保存星图",exact:true}).click();await expect(page.locator(".star-map-top>span")).toContainText("v1");
  await page.getByRole("button",{name:"回到群岛",exact:true}).click();
  await context.unroute("**/api/v1/discoveries");
  await context.route("**/api/v1/discoveries",route=>route.fulfill({json:{...known,entities:[],relations:[],chapters:[]}}));
  await openStars(page);await expect(page.locator(".star-empty")).toContainText("先发现第一束光");await expect(page.locator(".personal-star")).toHaveCount(0);
  await page.getByRole("button",{name:"回到群岛",exact:true}).click();await context.unroute("**/api/v1/discoveries");
  await context.route("**/api/v1/discoveries",route=>route.fulfill({status:503,json:{detail:"offline"}}));
  await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"我的星图"}).click();
  await expect(page.locator(".star-map-error")).toContainText("暂时没有连上");
  await page.getByRole("button",{name:"回到群岛",exact:true}).click();await expect(page.locator(".exploration-field")).toBeVisible();
});
