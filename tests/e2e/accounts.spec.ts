import {test,expect,type Page} from "@playwright/test";

const password="fixture account passphrase 2026";

async function draftStatus(page:Page){
  return page.evaluate(()=>new Promise<{tab:string|null;keys:IDBValidKey[];hasAlice:boolean}>((resolve,reject)=>{
    const open=indexedDB.open("learnai-recovery",1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{
      const db=open.result,store=db.transaction("drafts").objectStore("drafts");
      const keys=store.getAllKeys(),read=store.getAll();read.onsuccess=()=>{
        resolve({tab:sessionStorage.getItem("learnai-tab"),keys:keys.result,hasAlice:JSON.stringify(read.result).includes("Alice未保存草稿")});db.close();
      };read.onerror=()=>{db.close();reject(read.error);};
    };
  }));
}

async function submit(page:Page,username:string,register:boolean){
  await page.getByLabel("账号用户名").fill(username);
  await page.getByLabel("账号密码").fill(password);
  await page.getByRole("button",{name:register?"创建账号并进入":"登录并继续",exact:true}).click();
  await expect(page.locator(".auth-toolbar")).toContainText(username);
  await expect(page.getByRole("heading",{name:"让知识，连成你的理解。"})).toBeVisible();
}

test("注册、切换和退出隔离图谱与当前标签页草稿",async({page})=>{
  test.skip(process.env.LEARN_ACCOUNT_E2E!=="isolated-database","账号浏览器测试只在指定隔离数据库执行。");
  const suffix=crypto.randomUUID().slice(0,8),alice=`qa_alice_${suffix}`,bob=`qa_bob_${suffix}`;
  await page.setViewportSize({width:390,height:844});
  await page.goto("/workbench");
  await page.getByRole("button",{name:"登录 / 创建账号",exact:true}).click();
  await page.getByRole("button",{name:"没有账号，创建一个",exact:true}).click();
  await submit(page,alice,true);
  await page.locator(".react-flow__node").filter({hasText:"因果掩码"}).click();
  await page.getByLabel("我的解释").fill("Alice已保存解释");
  await page.getByRole("button",{name:"保存解释",exact:true}).click();
  await expect(page.getByRole("button",{name:"保存地图",exact:true})).toBeDisabled();
  await page.getByLabel("我的解释").fill("Alice未保存草稿");
  await expect.poll(async()=>(await draftStatus(page)).hasAlice).toBe(true);
  const original=await draftStatus(page);
  await page.getByRole("button",{name:"切换账号",exact:true}).click();
  await page.getByRole("button",{name:"没有账号，创建一个",exact:true}).click();
  await submit(page,bob,true);
  expect(await draftStatus(page)).toEqual(original);
  await expect(page.locator(".recovery")).toHaveCount(0);
  await page.locator(".react-flow__node").filter({hasText:"因果掩码"}).click();
  await expect(page.getByLabel("我的解释")).toHaveValue("");
  await page.getByRole("button",{name:"退出登录",exact:true}).click();
  await expect(page.getByRole("heading",{name:"回到你的群岛"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:".runtime/screenshots/accounts-mobile.png",fullPage:true});
  await submit(page,alice,false);
  expect(await draftStatus(page)).toEqual(original);
  await expect(page.locator(".recovery")).toContainText("未同步草稿");
  await page.getByRole("button",{name:"找回草稿",exact:true}).click();
  await page.locator(".react-flow__node").filter({hasText:"因果掩码"}).click();
  await expect(page.getByLabel("我的解释")).toHaveValue("Alice未保存草稿");
});
