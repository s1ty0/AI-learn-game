import {test,expect} from "@playwright/test";
import {fixture,open,fill} from "./revision-fixture";

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
