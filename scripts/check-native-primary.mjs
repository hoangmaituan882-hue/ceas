import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const {a,b}=JSON.parse(readFileSync(".cache/tmp/primary-e2e-latest.json","utf8"));
let browser,lastError;
for(let i=0;i<30;i++){
  try{browser=await chromium.connectOverCDP(process.env.CDP_URL??"http://127.0.0.1:9223");break;}
  catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,250));}
}
if(!browser)throw lastError;
const page=browser.contexts()[0].pages().find(page=>page.url().startsWith(process.env.APP_URL??"http://127.0.0.1:5174"))??browser.contexts()[0].pages()[0];
assert.ok(page,"未找到隔离的原生测试窗口");
const errors=[];page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
const invoke=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
try{
  await invoke("set_library_root",{path:a});await page.evaluate(()=>window.dispatchEvent(new Event("ceas-library-changed")));
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===2);
  const initial=await invoke("library_store",{libraryRoot:a,request:{action:"stats"}});assert.equal(initial.visible,2);
  const wrong=await page.evaluate(async root=>{try{await window.__TAURI_INTERNALS__.invoke("library_store",{libraryRoot:root,request:{action:"list"}});return "accepted";}catch(error){return String(error);}},b);
  assert.match(wrong,/已切换/);
  await invoke("library_store",{libraryRoot:a,request:{action:"delete",ids:["legacy-a"]}});
  await page.reload({waitUntil:"networkidle"});await page.waitForFunction(()=>document.querySelectorAll(".cell").length===1);
  await page.getByRole("button",{name:"回收站",exact:true}).click();await page.locator('.cell[data-id="legacy-a"]').waitFor();
  await page.locator('.cell[data-id="legacy-a"]').click();await page.getByRole("button",{name:"恢复",exact:true}).click();
  await page.getByText("回收站为空",{exact:true}).waitFor();
  await page.getByRole("button",{name:"资料库",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===2);
  await invoke("set_library_root",{path:b});await page.evaluate(()=>window.dispatchEvent(new Event("ceas-library-changed")));
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===1);
  await invoke("set_library_root",{path:a});await page.evaluate(()=>window.dispatchEvent(new Event("ceas-library-changed")));
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===2);
  await page.screenshot({path:".cache/shots/primary-native-ready.png"});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({native:true,initial,wrongScopeRejected:true,restartAndTrashRestore:true,switchAtoBtoA:true,errors},null,2));
}finally{await browser.close();}
