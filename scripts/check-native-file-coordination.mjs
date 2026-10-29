import assert from "node:assert/strict";
import {readFileSync,writeFileSync,copyFileSync,renameSync,unlinkSync,existsSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {chromium} from "playwright";

const report=JSON.parse(readFileSync(".cache/tmp/file-coordination-latest.json","utf8"));
assert.ok(resolve(report.base).startsWith(resolve(".cache/tmp")+"\\"),"只操作合成测试库");
let browser;
for(let attempt=0;attempt<40;attempt++){
 try{browser=await chromium.connectOverCDP((process.env.CDP_URL??"http://127.0.0.1:9223"));break;}
 catch(error){if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,250));}
}
let page;
for(let attempt=0;attempt<40;attempt++){
 page=browser.contexts().flatMap(c=>c.pages()).find(page=>page.url().startsWith((process.env.APP_URL??"http://127.0.0.1:5174")));
 if(page)break;
 await new Promise(resolve=>setTimeout(resolve,250));
}
assert.ok(page,`只连接隔离的原生窗口（${(process.env.APP_URL??"http://127.0.0.1:5174")}）`);
const errors=[],resources=[],passed=[],layouts=[];
page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
page.on("response",response=>{if(response.status()>=400)resources.push({url:response.url(),status:response.status()});});
const invoke=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const active=async()=>(await invoke("library_manage",{request:{action:"list"}})).active;
const store=async request=>{const lib=await active();return invoke("library_store",{libraryRoot:lib.path,librarySession:lib.session,request});};
const until=async(work,label)=>{const end=Date.now()+20000;while(Date.now()<end){const result=await work();if(result)return result;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`timeout: ${label}`);};
const idle=()=>page.waitForFunction(()=>window.__ceasFilePhase?.()==="idle",null,{timeout:60000});
try{
 await page.reload({waitUntil:"networkidle"});
 assert.equal((await active()).id,report.active.id);
 assert.equal(await page.evaluate(()=>typeof window.__nativeInvoke),"undefined","不注入 IPC 桥");
 await page.waitForFunction(()=>window.__ceasFilePhase?.()!==undefined);
 const deleted=(await store({action:"trash"})).find(row=>row.description==="外部改名和更新保留的描述");assert.ok(deleted);
 const original=JSON.parse((await store({action:"state"}))[`ceas.trash.${deleted.id}`]);
 const name=`native-${Date.now()}.png`,renamed=`原生验证/${name}`;
 copyFileSync(join(report.root,".ceas",original.target),join(report.root,name));
 const item=await until(async()=>(await store({action:"list"})).find(row=>row.relative_path===name),"native notification import");
 await page.locator(`.cell[data-id="${item.id}"]`).waitFor();
 await page.getByText(/文件通知已启用/u).waitFor();
 mkdirSync(join(report.root,"原生验证"),{recursive:true});renameSync(join(report.root,name),join(report.root,renamed));
 await until(async()=>(await store({action:"list"})).find(row=>row.id===item.id)?.relative_path===renamed,"native rename");
 unlinkSync(join(report.root,renamed));
 await until(async()=>JSON.parse((await store({action:"state"}))[`ceas.file.${item.id}`]).state==="missing","native missing");
 await page.locator(`.cell[data-id="${item.id}"] .file-state-badge`).waitFor();
 await page.evaluate(()=>window.__ceasOpenFileIssues?.());
 const panel=page.getByRole("dialog",{name:"文件问题",exact:true});await panel.getByText(renamed,{exact:true}).waitFor();
 await page.screenshot({path:".cache/shots/file-native-missing.png"});
 for(const theme of ["light","dark"])for(const density of ["compact","standard","airy"]){
  await page.evaluate(({theme,density})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.density=density;},{theme,density});
  const layout=await panel.evaluate(element=>({overflow:element.scrollWidth>element.clientWidth,focusInside:element.contains(document.activeElement)}));
  assert.equal(layout.overflow,false);assert.equal(layout.focusInside,true);layouts.push({theme,density,...layout});
 }
 await page.screenshot({path:".cache/shots/file-native-dark-airy.png"});
 await page.evaluate(()=>{document.documentElement.dataset.theme="light";document.documentElement.dataset.density="standard";});
 await page.keyboard.press("Escape");await panel.waitFor({state:"hidden"});
 await page.waitForFunction(()=>!document.activeElement?.closest("[role=dialog]"));
 passed.push("真实 Tauri 冷启动、原生通知新增/外部改名/缺失占位，六种主题密度与 Esc 回焦");
 copyFileSync(join(report.root,".ceas",original.target),join(report.root,renamed));
 await until(async()=>JSON.parse((await store({action:"state"}))[`ceas.file.${item.id}`]).state==="ready","native file returned");await idle();
 await page.locator(`.cell[data-id="${item.id}"]`).click({button:"right"});await page.getByRole("menuitem",{name:/^删除/u}).click();
 await until(async()=>(await store({action:"trash"})).some(row=>row.id===item.id),"native physical trash");
 assert.equal(existsSync(join(report.root,renamed)),false);
 const replacement=readFileSync(join(report.root,"找回.png"));writeFileSync(join(report.root,renamed),replacement);
 await until(async()=>(await store({action:"list"})).some(row=>row.relative_path===renamed),"native replacement");await idle();
 await page.getByRole("button",{name:/回收站/u}).click();await page.locator(`.cell[data-id="${item.id}"]`).click();
 await page.getByRole("button",{name:"恢复",exact:true}).click();const restore=page.getByRole("dialog",{name:"恢复原件",exact:true});
 await restore.getByText(/原地址已占用/u).waitFor();await page.screenshot({path:".cache/shots/file-native-restore.png"});
 await restore.getByRole("button",{name:"取消",exact:true}).click();assert.ok((await store({action:"trash"})).some(row=>row.id===item.id));
 await page.getByRole("button",{name:"恢复",exact:true}).click();await restore.getByRole("button",{name:"恢复，保留双方",exact:true}).click();
 await restore.waitFor({state:"hidden"});const recovered=(await store({action:"list"})).find(row=>row.id===item.id);
 assert.ok(recovered.relative_path.includes("恢复 1"));assert.deepEqual(readFileSync(join(report.root,renamed)),replacement);
 passed.push("真实原生回收、恢复预览取消与同名保留双方，磁盘原件和 SQLite 状态一致");
 assert.deepEqual(errors,[]);assert.deepEqual(resources,[]);
 const result={native:true,passed,layouts,errors,resources,root:report.root,runtime:report.runtime};
 writeFileSync(".cache/tmp/file-native-latest.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await page.screenshot({path:".cache/shots/file-native-error.png"}).catch(()=>{});console.error({passed,errors,resources});throw error;}
finally{await browser.close();}
