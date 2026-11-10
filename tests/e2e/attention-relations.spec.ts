import {test,expect,type Page,type BrowserContext} from "@playwright/test";
import {fixture,open} from "./revision-fixture";

type Template="softmax-aggregation"|"causal-attention";
async function setup(page:Page,context:BrowserContext,template:Template){
 const f=await fixture(page,context,template);let revision=5,active:Record<string,unknown>|null=null,lose=false;
 const reports:Record<string,unknown>[]=[],keys:string[]=[],operations=new Map<string,unknown>();
 const support={kind:template==="softmax-aggregation"?"weights":"mask",title:template==="softmax-aggregation"?"拨动一束光的参与比例":"开关一条读取光路",text:template==="softmax-aggregation"?"只看两个标量2和8。":"先只读2和6，等权输出4。",boundary:"回原题重新按允许项的分数归一化；小例子不代替原题。"};
 const state=()=>({revision,goals:[],active,reports});
 await page.route("**/api/v1/candidates{,?*}",route=>route.fulfill({json:{items:[],total:0,next_offset:null}}));
 await page.route("**/api/v1/relation-revisions/challenge/*",route=>route.fulfill({json:{revision_id:"repair-1",source_attempt:"source-repair",graph_revision:1,edge:f.current(),focuses:[{id:"path",title:"检查推导"},{id:"conditions",title:"检查条件"}],note:"每轮只练一处，不计入候选或跳级。"}}));
 await page.route("**/api/v1/verification",route=>route.fulfill({json:state()}));
 await page.route("**/api/v1/verification/attempts/*",route=>route.fulfill({json:reports.at(-1)}));
 await page.route("**/api/v1/verification/actions",async route=>{
  const body=route.request().postDataJSON();keys.push(body.operation_key);
  if(operations.has(body.operation_key)){await route.fulfill({json:operations.get(body.operation_key)});return;}
  expect(body.base_revision).toBe(revision);
  if(body.action==="start_revision_challenge"){
   expect(body.revision_id).toBe("repair-1");expect(body.revision_focus).toBe("path");
   active={id:"attention-1",goal:template==="softmax-aggregation"?"weights":"mask",kind:"revision_challenge",title:"修订挑战：检查推导",prompt:template==="softmax-aggregation"?"指数值3、1，V为−4、8。先归一化再汇聚。":"位置1只读0、1。三项指数值2、1、7，V为−3、9、100。先排除位置2。",options:["第一种结果","第二种结果","第三种结果"],repeat_family:false,support_available:true,help_used:false};
  }else if(body.action==="support"){
   expect(body.attempt_id).toBe("attention-1");active={...active,help_used:true,support};
  }else{
   expect(body.action).toBe("submit");const helped=active!.help_used===true;
   reports.push({id:"attention-1",...active,...body,used_help:helped||body.used_help,independence:helped?"supported":"not_established",choice_matches:true,self_reviews:[],rubric:[],rationale:"先在允许项上归一化，再汇聚。",task_version:"fixture",graph_revision:1,revision_origin:{revision_id:"repair-1",source_attempt:"source-repair",focus:"path",graph_revision:1},target_feedback:{title:"检查推导",message:"本题选择符合规则，解释仍需复核。"}});active=null;
  }
  revision++;const result=structuredClone(state());operations.set(body.operation_key,result);
  if(body.action==="support"&&lose){lose=false;await route.fulfill({status:503,json:{detail:"response lost"}});return;}
  await route.fulfill({json:result});
 });
 await open(page);await page.getByLabel(`${template==="softmax-aggregation"?"计算关系":"读取路径"} · 待澄清`).check();await page.getByLabel("成立条件 · 有分歧").check();
 await page.getByLabel("修订后的关系命题").fill("先确定允许项，再归一化权重并汇聚V");await page.getByLabel("修订后的关系条件").fill("局部标量计算无dropout或投影，其他路径另查。");await page.getByLabel("关系修订理由").fill("补上归一化范围和固定条件。");await page.getByLabel("关系修订反例").fill("其他路径改变时，局部结论不能推广。");await page.getByRole("button",{name:"保存修订，生成星图新版本",exact:true}).click();await page.getByText("星图v0 → v1",{exact:false}).click();await page.getByRole("button",{name:"挑战这次修订",exact:true}).click();await page.getByRole("button",{name:"开始这次缺口挑战",exact:true}).click();
 return {keys,lose:()=>{lose=true;}};
}

test("Softmax修订后可拖动局部比例，帮助状态随作答保留",async({page,context})=>{
 await setup(page,context,"softmax-aggregation");await expect(page.locator(".relation-bridge")).toHaveCount(0);await page.getByLabel("验证解释",{exact:true}).fill("先归一化，暂时还不确定如何比较。");await page.getByRole("button",{name:"卡住了，补一小步",exact:true}).click();
 await expect(page.getByLabel("验证解释",{exact:true})).toHaveValue("先归一化，暂时还不确定如何比较。");await expect(page.getByLabel("补桥汇聚结果",{exact:true})).toContainText("6.5");const slider=page.getByLabel("补桥第一束比例",{exact:true});await slider.press("End");for(let i=0;i<5;i++)await slider.press("ArrowLeft");await expect(page.getByLabel("补桥汇聚结果",{exact:true})).toContainText("3.5");
 const help=page.getByLabel("这次查看过资料、答案或使用了他人/AI帮助");await expect(help).toBeChecked();await expect(help).toBeDisabled();await page.screenshot({path:".runtime/screenshots/attention-weights-desktop.png",fullPage:true});await page.getByLabel("第一种结果",{exact:true}).check();await page.getByRole("button",{name:"提交解释，留下原文",exact:true}).click();await expect(page.locator(".verification-room")).toContainText("本次标记使用帮助");
});

test("手机掩码补桥可开关光路，分母和输出一起改变",async({page,context})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,context,"causal-attention");await page.getByRole("button",{name:"卡住了，补一小步",exact:true}).click();await expect(page.getByLabel("补桥汇聚结果",{exact:true})).toContainText("分母：2");await page.getByRole("button",{name:"打开第三条光路",exact:true}).click();await expect(page.getByLabel("补桥汇聚结果",{exact:true})).toContainText("19.333 · 分母：3");await page.getByRole("button",{name:"关闭第三条光路",exact:true}).click();await expect(page.getByLabel("补桥汇聚结果",{exact:true})).toContainText("输出：4");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:".runtime/screenshots/attention-mask-mobile.png",fullPage:true});
});

test("补桥响应丢失同键重试，刷新后帮助标记仍不能清除",async({page,context})=>{
 const f=await setup(page,context,"softmax-aggregation");f.lose();await page.getByRole("button",{name:"卡住了，补一小步",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("提交未确认");await page.getByRole("button",{name:"卡住了，补一小步",exact:true}).click();expect(f.keys.at(-1)).toBe(f.keys.at(-2));
 await page.reload();await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"把关系讲通"}).click();await expect(page.locator(".relation-bridge")).toContainText("拨动一束光");await expect(page.getByLabel("这次查看过资料、答案或使用了他人/AI帮助")).toBeChecked();
});
