import {test,expect,type Page} from "@playwright/test";
import {expeditionFixture} from "./expedition-fixture";

async function fixture(page:Page) {
  await expeditionFixture(page,"representation");
  let count=0,revision=0,finished=false,hint=false,fail=false,conflict=false;
  const keys:string[]=[];
  function state(){return {revision,version:"fixture-v1",answered:count,total:10,finished,
    task:finished?null:{id:`task-${count}`,domain:"数据理解",kind:"选择探测",prompt:`第${count+1}个情境，选出合适做法`,options:["做法甲","做法乙","做法丙"],hint:hint?"先区分已知与目标。":null},
    domains:[{name:"数据理解",tested:count,evidence:count?[{task_id:"task-0",kind:"选择探测",outcome:"unknown",explanation:"我的理由",hint_used:true,feedback:"单次选择不代表掌握。"}]:[]},{name:"程序阅读",tested:0,evidence:[]}],
    recommendation:{title:"表征工坊",reason:"先建立直观连接。"},last_feedback:count?"先区分已知输入和预测目标。":null};}
  await page.route("**/api/v1/intake",route=>route.fulfill({json:state()}));
  await page.route("**/api/v1/intake/actions",async route=>{
    const body=route.request().postDataJSON();keys.push(body.operation_key);
    if(fail){fail=false;await route.fulfill({status:503,json:{detail:"offline"}});return;}
    if(conflict){conflict=false;await route.fulfill({status:409,json:{detail:"conflict"}});return;}
    revision++;if(body.action==="hint")hint=true;
    if(body.action==="answer"){count++;hint=false;finished=count===10;}
    if(body.action==="finish")finished=true;
    await route.fulfill({json:state()});
  });
  return {keys,fail:()=>{fail=true;},conflict:()=>{conflict=true;count++;revision++;}};
}
async function open(page:Page){await page.goto("/");await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"找到我的起点"}).click();await expect(page.getByRole("heading",{name:"找到我的起点",exact:true})).toBeVisible();}

test("十步画像可保存并回看，刷新续接，返回原探索",async({page})=>{
  await fixture(page);await open(page);await page.getByRole("button",{name:"开始探测",exact:true}).click();
  for(let i=0;i<10;i++){
    await expect(page.locator(".intake-card h2")).toContainText(`第${i+1}个情境`);
    await page.getByLabel("做法甲",{exact:true}).check();
    await page.getByLabel("起点探测理由",{exact:true}).fill("这是我选择的原因。");
    await page.getByRole("button",{name:"记录并继续",exact:true}).click();
    if(i===0){await expect(page.locator(".intake-top")).toContainText("1 / 10");await page.reload();await page.getByRole("button",{name:"更多",exact:true}).click();await page.getByRole("button").filter({hasText:"找到我的起点"}).click();}
  }
  await expect(page.locator(".intake-room")).toContainText("本次起点记录已保存");
  await expect(page.locator(".intake-summary")).toContainText("尚未探测，保持未知");
  await page.screenshot({path:".runtime/screenshots/intake-summary.png",fullPage:true});
  await page.getByRole("button",{name:"回到当前探索",exact:true}).click();await expect(page.locator(".exploration-field")).toBeVisible();
});

test("线索单独记录，失败保留输入和幂等键，可提前结束",async({page})=>{
  const f=await fixture(page);await open(page);await page.getByRole("button",{name:"开始探测",exact:true}).click();
  await page.getByRole("button",{name:"给一点线索",exact:true}).click();await expect(page.locator(".intake-hint")).toContainText("已知");
  await page.getByLabel("做法甲",{exact:true}).check();await page.getByLabel("起点探测理由").fill("失败也要保留的文字");
  f.fail();await page.getByRole("button",{name:"记录并继续",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("尚未确认");
  await expect(page.getByLabel("起点探测理由")).toHaveValue("失败也要保留的文字");
  await page.getByRole("button",{name:"记录并继续",exact:true}).click();await expect(page.locator(".intake-top")).toContainText("1 / 10");expect(f.keys[1]).toBe(f.keys[2]);
  await page.getByText("暂时到这里",{exact:true}).click();await page.getByRole("button",{name:"保存已有记录并结束",exact:true}).click();
  await expect(page.locator(".intake-room")).toContainText("建议试试：表征工坊");
});

test("390像素可操作，冲突不自动重交，断线可返回",async({page})=>{
  const f=await fixture(page);await page.setViewportSize({width:390,height:844});await open(page);await page.getByRole("button",{name:"开始探测",exact:true}).click();
  await page.screenshot({path:".runtime/screenshots/intake-mobile.png",fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByLabel("起点探测理由").fill("旧题的理由要单独保留");
  f.conflict();await page.getByRole("button",{name:"还不知道",exact:true}).click();await expect(page.locator(".intake-error")).toContainText("另一处更新");
  await expect(page.getByRole("button",{name:"还不知道",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"读取最新进度",exact:true}).click();await expect(page.locator(".intake-card h2")).toContainText("第2个情境");
  await expect(page.getByLabel("起点探测理由")).toHaveValue("");
  await page.getByText("上一题未提交的输入，仅在当前页面保留",{exact:true}).click();
  await expect(page.locator(".intake-feedback")).toContainText("旧题的理由要单独保留");
  await page.getByRole("button",{name:"回到群岛",exact:false}).click();
  await page.unroute("**/api/v1/intake");await page.route("**/api/v1/intake",route=>route.fulfill({status:503,json:{detail:"offline"}}));
  await open(page);await expect(page.locator(".intake-error")).toContainText("暂未连接");
  await page.getByRole("button",{name:"回到群岛",exact:false}).click();await expect(page.locator(".exploration-field")).toBeVisible();
});
