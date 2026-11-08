import {test,expect,type Page} from "@playwright/test";
import {expeditionFixture} from "./expedition-fixture";

async function fixture(page:Page){
  await expeditionFixture(page,"representation");
  let revision=0,mode:string|null=null,cause:string|null=null,hint=false,variant=0,fail=false,conflict=false;
  const keys:string[]=[];const history:Record<string,unknown>[]=[];
  const target={id:"token",title:"碎词码头",stage:0};
  function state(){return {revision,version:"fixture",target,available:[{...target,optional:false}],reason:cause==="operation"?"先解决操作；操作困难不记为知识薄弱。":mode==="easy"?"先收起讲解做一个短探测。":"先补一条局部关系，再回原机关。",profile_note:"没有画像时保留未知。",mode,cause,
    task:mode && cause!=="operation"?{id:`task-${variant}`,prompt:variant?"嵌入表编号1应该查哪一行？":"固定词表中，蓝的编号是1。蓝对应什么？",options:["编号1","编号0","编号2"],hint:hint?"逐项查固定表。":null,bridge:mode==="easy"?null:"编号是查表地址，不表示语义距离。",kind:mode==="easy"&&!hint?"独立选择探测":"支持下练习"}:null,history};}
  await page.route("**/api/v1/guidance",route=>route.fulfill({json:state()}));
  await page.route("**/api/v1/guidance/actions",async route=>{
    const body=route.request().postDataJSON();keys.push(body.operation_key);
    if(fail){fail=false;await route.fulfill({status:503,json:{detail:"offline"}});return;}
    if(conflict){conflict=false;revision++;variant++;await route.fulfill({status:409,json:{detail:"conflict"}});return;}
    revision++;if(body.action==="feedback"){mode=body.feedback;cause=body.cause??null;if(mode==="example")variant=1-variant;hint=false;}
    if(body.action==="hint")hint=true;
    history.push({action:body.action,target:"token",stage:0,task_id:body.task_id,created_at:"2026-11-08T00:00:00Z",feedback:body.feedback,cause:body.cause,...(body.action==="answer"?{outcome:"supported_choice",feedback_text:"依次查表，编号不表示语义远近。"}:{})});
    await route.fulfill({json:state()});
  });
  return {keys,fail:()=>{fail=true;},conflict:()=>{conflict=true;}};
}
async function open(page:Page){await page.goto("/");await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"下一束光"}).click();await expect(page.getByRole("heading",{name:"下一束光",exact:true})).toBeVisible();await expect(page.locator(".guidance-room")).toContainText("碎词码头");}

test("领航补桥、线索、作答保存，刷新回看并进入真正可达关卡",async({page})=>{
  await fixture(page);await open(page);
  await page.getByLabel("困难原因",{exact:true}).selectOption("term");await page.getByRole("button",{name:"太难了",exact:true}).click();
  await expect(page.locator(".guidance-room")).toContainText("编号是查表地址");
  await page.getByRole("button",{name:"给一点线索",exact:true}).click();await expect(page.locator(".guidance-room")).toContainText("逐项查固定表");
  await page.getByLabel("编号1",{exact:true}).check();await page.getByRole("button",{name:"记录这个判断",exact:true}).click();
  await expect(page.locator(".intake-feedback")).toContainText("支持下完成");
  await page.screenshot({path:".runtime/screenshots/guidance-desktop.png",fullPage:true});
  await open(page);await expect(page.locator(".guidance-room")).toContainText("依次查表");
  await page.getByRole("button",{name:"进入这一步探索",exact:true}).click();await expect(page.locator(".expedition-lab")).toBeVisible();
});

test("操作困难不给概念降级，过易收讲解，换例子和503重试保留选择",async({page})=>{
  const f=await fixture(page);await open(page);
  await page.getByLabel("困难原因").selectOption("operation");await page.getByRole("button",{name:"太难了",exact:true}).click();
  await expect(page.locator(".guidance-room")).toContainText("操作困难不记为知识薄弱");await expect(page.getByRole("button",{name:"记录这个判断",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"太简单",exact:true}).click();await expect(page.locator(".guidance-room")).toContainText("独立选择探测");
  await expect(page.locator(".intake-hint")).toHaveCount(0);
  await page.getByLabel("编号1",{exact:true}).check();f.fail();await page.getByRole("button",{name:"记录这个判断",exact:true}).click();
  await expect(page.locator(".intake-error")).toContainText("尚未确认");await expect(page.getByLabel("编号1",{exact:true})).toBeChecked();
  await page.getByRole("button",{name:"记录这个判断",exact:true}).click();await expect(page.locator(".intake-feedback")).toContainText("依次查表");expect(f.keys.at(-1)).toBe(f.keys.at(-2));
  await page.getByRole("button",{name:"换个例子",exact:true}).click();await expect(page.locator(".guidance-room")).toContainText("嵌入表编号1");
});

test("手机领航可用，409读新题隔离旧选择，断线仍可返回",async({page})=>{
  const f=await fixture(page);await page.setViewportSize({width:390,height:844});await open(page);await page.getByRole("button",{name:"太简单",exact:true}).click();
  await page.getByLabel("编号1",{exact:true}).check();f.conflict();await page.getByRole("button",{name:"记录这个判断",exact:true}).click();
  await expect(page.getByRole("button",{name:"记录这个判断",exact:true})).toBeDisabled();await page.getByRole("button",{name:"读取最新建议",exact:true}).click();
  await page.getByText("先前未提交的选择",{exact:true}).click();await expect(page.locator(".intake-feedback")).toContainText("固定词表中");
  await expect(page.getByLabel("编号1",{exact:true})).not.toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:".runtime/screenshots/guidance-mobile.png",fullPage:true});
  await page.getByRole("button",{name:"回到群岛",exact:true}).click();await page.unroute("**/api/v1/guidance");await page.route("**/api/v1/guidance",route=>route.fulfill({status:503,json:{detail:"offline"}}));
  await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"下一束光"}).click();await expect(page.locator(".intake-error")).toContainText("暂时未连接");
  await page.getByRole("button",{name:"回到群岛",exact:true}).click();await expect(page.locator(".exploration-field")).toBeVisible();
});
