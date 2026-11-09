import {test,expect,type Page,type BrowserContext} from "@playwright/test";
import {expeditionFixture} from "./expedition-fixture";
import {workbenchFixture} from "./workbench-fixture";
import type {Snapshot} from "../../apps/web/src/lib/api";

const seed:Snapshot={revision:0,release_id:"fixture",created_at:"2026-11-09T00:00:00Z",restored_from:null,note:"图",payload:{nodes:[
 {id:"entity-0144",type:"knowledge",position:{x:0,y:0},data:{label:"token",subtitle:"",category:"custom",note:""}},
 {id:"entity-0073",type:"knowledge",position:{x:250,y:0},data:{label:"词嵌入",subtitle:"",category:"custom",note:""}},
],edges:[{id:"my-edge",source:"entity-0144",target:"entity-0073",label:"编号按行查到向量",note:"固定编号和嵌入表，编号不表示语义距离。"}]}};
async function fixture(page:Page,context:BrowserContext){
 const store=await workbenchFixture(context,structuredClone(seed));await expeditionFixture(page,"representation");
 await page.route("**/api/v1/discoveries",route=>route.fulfill({json:{chapters:[{id:"representation",title:"表征工坊"}],entities:seed.payload.nodes.map(n=>({id:n.id,name:n.data.label,chapters:["representation"],origins:[]})),relations:[]}}));
 await page.route("**/api/v1/star-evidence{,/**}",route=>route.fulfill({json:{entities:[],goals:[],items:[],total:0,next_offset:null}}));
 await page.route("**/api/v1/candidates{,?*}",route=>route.fulfill({json:{items:[],interval_hours:72,policy:"fixture"}}));
 let offline=false,unsupported=false,stale=false,revision=0,active:Record<string,unknown>|null=null;
 const reports:Record<string,unknown>[]=[];let binding:Record<string,unknown>|null=null;
 const bindingEdge=structuredClone(seed.payload.edges[0]);
 await page.route("**/api/v1/relation-evidence/*",async route=>{
  if(offline){await route.fulfill({status:503,json:{detail:"offline"}});return;}
  const saved=store.current();const edge=saved.payload.edges[0];
  await route.fulfill({json:{graph_revision:saved.revision,edge,templates:unsupported?[]:[{id:"lookup-map",title:"编号与嵌入查表关系"}],items:binding?[{id:"bound-1",status:edge.label===bindingEdge.label&&edge.note===bindingEdge.note?"needs_evidence":"relation_changed",reason:"对照这次绑定的原命题和条件。",matches_current:edge.label===bindingEdge.label&&edge.note===bindingEdge.note,binding,initial:{checks:[{id:"criteria",ok:false,label:"具体命题仍需逐项复核"}]},recheck_attempt:null,active_recheck:null}]:[]}});
 });
 function state(){return {revision,goals:[],active,reports};}
 await page.route("**/api/v1/verification",route=>route.fulfill({json:state()}));
 await page.route("**/api/v1/verification/attempts/*",route=>route.fulfill({json:reports[0]}));
 await page.route("**/api/v1/verification/actions",async route=>{
  const body=route.request().postDataJSON();
  if(body.action==="start_relation"){
   expect(body.edge_id).toBe("my-edge");expect(body.relation_template).toBe("lookup-map");expect(body.graph_revision).toBe(store.current().revision);
   if(stale){await route.fulfill({status:409,json:{detail:"changed"}});return;}
   binding={template:"lookup-map",graph_revision:store.current().revision,edge:structuredClone(store.current().payload.edges[0])};
   active={id:"bound-1",goal:"lookup",title:"关系验证：编号与嵌入查表关系",prompt:"我的原命题：编号按行查到向量。理由：固定编号和嵌入表。先判断原命题是否成立，再讨论换表条件。",options:["第一种","第二种","第三种"],repeat_family:false};
  }else if(body.action==="submit"){
   reports.push({...active,...body,id:"bound-1",binding,choice_matches:true,independence:"not_established",status:"pending_review",rubric:[],rationale:"固定映射下查表。",self_reviews:[],graph_revision:0,task_version:"relation-fixture"});active=null;
  }
  revision++;await route.fulfill({json:state()});
 });
 return {store,offline:()=>{offline=true;},unsupported:()=>{unsupported=true;},stale:()=>{stale=true;}};
}
async function open(page:Page){await page.goto("/");await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"我的星图"}).click();await page.getByLabel("选择星图连接").selectOption("my-edge");await expect(page.locator(".relation-evidence-panel")).toBeVisible();}

test("明确绑定保存的命题，提交后改写不继承旧证据",async({page,context})=>{
 const f=await fixture(page,context);await open(page);await page.getByRole("button",{name:"前往绑定这条关系",exact:true}).click();
 await expect(page.locator(".verification-room")).toContainText("星图v0");await page.getByRole("button",{name:"确认关系绑定并开始",exact:true}).click();await expect(page.locator(".verification-room")).toContainText("我的原命题");
 await page.getByLabel("第二种",{exact:true}).check();await page.getByLabel("验证解释").fill("原命题需要固定映射和逐项查表，换编号必须同步改变表行，不能推广语义距离。");await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();await expect(page.locator(".verification-room")).toContainText("解释：待独立复核");
 await page.getByRole("button",{name:"回到我的星图",exact:true}).click();await page.getByLabel("选择星图连接").selectOption("my-edge");await page.locator(".relation-evidence-panel summary").click();await expect(page.locator(".relation-evidence-panel")).toContainText("绑定原文：编号按行查到向量");
 await page.getByLabel("星图关系名称").fill("我后来改写的关系");await expect(page.getByRole("button",{name:"前往绑定这条关系",exact:true})).toBeDisabled();await page.getByRole("button",{name:"保存星图",exact:true}).click();await expect(page.locator(".relation-evidence-panel")).toContainText("原关系已改变");
  await page.locator(".relation-evidence-panel").scrollIntoViewIfNeeded();await page.screenshot({path:".runtime/screenshots/relation-evidence-desktop.png",fullPage:true});expect(f.store.current().payload.edges[0].label).toBe("我后来改写的关系");
});

test("缺条件、未保存与旧图不能直接发起绑定，旧命题可回看",async({page,context})=>{
 await fixture(page,context);await open(page);await page.getByLabel("星图关系的理由与条件").fill("");await expect(page.getByRole("button",{name:"前往绑定这条关系",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"保存星图",exact:true}).click();await expect(page.locator(".star-map-top>span")).toContainText("v1");await expect(page.getByRole("button",{name:"前往绑定这条关系",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"历史版本",exact:true}).click();await page.locator(".star-history>button").filter({hasText:"v0"}).click();await page.getByRole("button",{name:"我的理解",exact:true}).click();await page.getByLabel("选择星图连接").selectOption("my-edge");await expect(page.locator(".relation-evidence-panel")).toContainText("旧图不能直接发起绑定");
});

test("手机未覆盖或故障不阻塞原文保存，陈旧绑定拒绝但不丢图",async({page,context})=>{
 const f=await fixture(page,context);await page.setViewportSize({width:390,height:844});await open(page);f.unsupported();await page.getByRole("button",{name:"刷新这条关系的证据",exact:true}).click();await expect(page.locator(".relation-evidence-panel")).toContainText("没有专属关系验证模板");
 f.offline();await page.getByRole("button",{name:"刷新这条关系的证据",exact:true}).click();await expect(page.locator(".relation-evidence-panel")).toContainText("编辑和保存仍可继续");await page.getByLabel("星图关系的理由与条件").fill("故障时继续保留我的关系条件。");await page.getByRole("button",{name:"保存星图",exact:true}).click();await expect(page.locator(".star-map-top>span")).toContainText("v1");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:".runtime/screenshots/relation-evidence-mobile.png",fullPage:true});expect(f.store.current().payload.edges[0]).toHaveProperty("note","故障时继续保留我的关系条件。");
});

test("绑定时服务器图版本冲突，保留原关系且不自动开始",async({page,context})=>{
 const f=await fixture(page,context);await open(page);await page.getByRole("button",{name:"前往绑定这条关系",exact:true}).click();f.stale();await page.getByRole("button",{name:"确认关系绑定并开始",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("验证记录已更新");await expect(page.getByRole("button",{name:"确认关系绑定并开始",exact:true})).toBeDisabled();await page.getByRole("button",{name:"回到我的星图",exact:true}).click();expect(f.store.current().revision).toBe(0);
});
