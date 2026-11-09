import {test,expect,type Page,type BrowserContext} from "@playwright/test";
import {expeditionFixture} from "./expedition-fixture";
import {workbenchFixture} from "./workbench-fixture";
import type {Snapshot} from "../../apps/web/src/lib/api";

const edge={id:"repair-edge",source:"entity-0144",target:"entity-0073",label:"编号越接近语义越接近",note:"原先的理由，尚需检查。"};
const seed:Snapshot={revision:0,release_id:"fixture",created_at:"2026-11-09T00:00:00Z",restored_from:null,note:"图",payload:{nodes:[{id:"entity-0144",type:"knowledge",position:{x:0,y:0},data:{label:"token",subtitle:"",category:"custom",note:""}},{id:"entity-0073",type:"knowledge",position:{x:200,y:0},data:{label:"词嵌入",subtitle:"",category:"custom",note:""}}],edges:[edge]}};
async function fixture(page:Page,context:BrowserContext){
 await workbenchFixture(context,structuredClone(seed));await expeditionFixture(page,"representation");
 await page.route("**/api/v1/discoveries",route=>route.fulfill({json:{chapters:[{id:"representation",title:"表征工坊"}],entities:seed.payload.nodes.map(n=>({id:n.id,name:n.data.label,chapters:["representation"],origins:[]})),relations:[]}}));
 await page.route("**/api/v1/star-evidence{,/**}",route=>route.fulfill({json:{entities:[],goals:[],items:[],total:0,next_offset:null}}));
 await page.route("**/api/v1/relation-evidence/*",route=>route.fulfill({json:{graph_revision:0,edge,templates:[],items:[{id:"source-repair",status:"needs_evidence",reason:"原关系需要澄清。",binding:{template:"lookup-map",graph_revision:0,edge},matches_current:true,initial:{checks:[{id:"conditions",ok:false,label:"查表条件需明确"}]}}]}}));
 let graphRevision=0,reviewRevision=1,verificationRevision=4,fail=false,conflict=false;
 let current={...edge};const history:Record<string,unknown>[]=[],keys:string[]=[];
 const criteria=[{id:"path",title:"查表关系",requirement:"核查原命题是否成立。",gap:true,disputed:false,opinions:[{reviewer:"复核者甲",review_id:"r1",judgement:"partial",quote:"编号越接近",reason:"编号是地址，不能用编号差判断语义距离。"}]},{id:"conditions",title:"成立条件",requirement:"说明固定映射。",gap:true,disputed:true,opinions:[]},{id:"boundary",title:"边界反例",requirement:"给出反例。",gap:true,disputed:false,opinions:[]}];
 function state(){return {title:"修订查表关系",source_attempt:"source-repair",graph_revision:graphRevision,review_revision:reviewRevision,verification_revision:verificationRevision,binding:{edge,graph_revision:0},current,answer:"原来对编号距离的解释。",criteria,history};}
 await page.route("**/api/v1/relation-revisions/*",async route=>{
  if(route.request().method()==="POST"){
   const body=route.request().postDataJSON();keys.push(body.operation_key);
   if(fail){fail=false;await route.fulfill({status:503,json:{detail:"保存未确认，草稿保留。"}});return;}
   if(conflict){conflict=false;graphRevision++;current={...current,label:"另一处保存的关系命题"};reviewRevision++;await route.fulfill({status:409,json:{detail:"stale"}});return;}
   expect(body.graph_revision).toBe(graphRevision);expect(body.review_revision).toBe(reviewRevision);expect(body.verification_revision).toBe(verificationRevision);
   const before=current;current={...current,label:body.label,note:body.note};graphRevision++;verificationRevision++;
   history.push({id:"repair-1",created_at:"2026-11-09T00:00:00Z",graph_before:graphRevision-1,graph_after:graphRevision,before,after:current,criteria:body.criteria,reason:body.reason,counterexample:body.counterexample,review_revision:reviewRevision,source_reviews:[{id:"r1",actor_name:"复核者甲",items:[{criterion:"path",judgement:"partial",quote:"编号越接近",reason:"不是语义距离"}]}]});
   await route.fulfill({json:{id:"repair-1",graph_revision:graphRevision,verification_revision:verificationRevision,status:"revised_not_verified",mastery:"unverified"}});return;
  }
  await route.fulfill({json:state()});
 });
 return {keys,fail:()=>{fail=true;},conflict:()=>{conflict=true;}};
}
async function open(page:Page){await page.goto("/");await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"我的星图"}).click();await page.getByLabel("选择星图连接").selectOption("repair-edge");await page.locator(".relation-evidence-panel summary").click();await page.getByRole("button",{name:"把缺口变成修订任务",exact:true}).click();await expect(page.getByRole("heading",{name:"修好这条关系",exact:true})).toBeVisible();}
async function fill(page:Page){await page.getByLabel("查表关系 · 待澄清").check();await page.getByLabel("修订后的关系命题").fill("token通过固定编号对应到嵌入表行");await page.getByLabel("修订后的关系条件").fill("词表编号与表行映射保持一致，编号本身不表示语义距离。");await page.getByLabel("关系修订理由").fill("补上原来遗漏的映射条件，纠正用编号差推断语义的错误。");await page.getByLabel("关系修订反例").fill("只换词表编号、不改表行会造成错配。");}

test("复核缺口转为修订并保留前后与依据，保存不认证掌握",async({page,context})=>{
 await fixture(page,context);await open(page);await expect(page.locator(".relation-revision-room")).toContainText("编号是地址");await expect(page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true})).toBeDisabled();await fill(page);
 await page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true}).click();await expect(page.getByRole("status")).toContainText("星图v1，尚未验证");await page.getByText("星图v0 → v1",{exact:false}).click();await expect(page.locator(".relation-revision-room")).toContainText("修改前：编号越接近语义越接近");await expect(page.locator(".relation-revision-room")).toContainText("修改后：token通过固定编号");
 await page.screenshot({path:".runtime/screenshots/relation-revision-desktop.png",fullPage:true});await page.getByRole("button",{name:"回到我的星图",exact:true}).click();await expect(page.getByRole("heading",{name:"我的星图",exact:true})).toBeVisible();
});

test("503重试不重复提交，修订草稿刷新可找回",async({page,context})=>{
 const f=await fixture(page,context);await open(page);await fill(page);f.fail();await page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("保存未确认");await expect(page.getByLabel("关系修订反例")).toHaveValue("只换词表编号、不改表行会造成错配。");
 await open(page);await expect(page.locator(".revision-recovery")).toContainText("未提交修订草稿");await page.getByRole("button",{name:"对照后应用这份草稿",exact:true}).click();await expect(page.getByLabel("修订后的关系命题")).toHaveValue("token通过固定编号对应到嵌入表行");
 f.fail();await page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("保存未确认");await page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true}).click();await expect(page.getByRole("status")).toContainText("修订已保存");expect(f.keys.at(-1)).toBe(f.keys.at(-2));
});

test("手机409明确比较再应用草稿，不覆盖其他窗口",async({page,context})=>{
 const f=await fixture(page,context);await page.setViewportSize({width:390,height:844});await open(page);await fill(page);f.conflict();await page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true}).click();await expect(page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true})).toBeDisabled();await page.getByRole("button",{name:"读取最新修订任务",exact:true}).click();await expect(page.locator(".revision-recovery")).toContainText("当前为v1");await page.getByText("比较草稿与当前关系",{exact:true}).click();await expect(page.locator(".revision-recovery")).toContainText("另一处保存的关系命题");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:".runtime/screenshots/relation-revision-mobile.png",fullPage:true});await page.getByRole("button",{name:"对照后应用这份草稿",exact:true}).click();await page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true}).click();await expect(page.getByRole("status")).toContainText("星图v2，尚未验证");
});
