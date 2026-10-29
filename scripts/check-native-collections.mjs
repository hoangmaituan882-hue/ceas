import assert from "node:assert/strict";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {chromium} from "playwright";
const report=JSON.parse(readFileSync(".cache/tmp/collections-latest.json","utf8"));
assert.ok(resolve(report.base).startsWith(resolve(".cache/tmp")+"\\"),"只操作隔离合成库");
const appUrl=process.env.APP_URL??"http://127.0.0.1:5174",cdpUrl=process.env.CDP_URL??"http://127.0.0.1:9223";
let browser,page;
for(let attempt=0;attempt<40;attempt++){try{browser=await chromium.connectOverCDP(cdpUrl);break;}catch(error){if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}
for(let attempt=0;attempt<40;attempt++){page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith(appUrl));if(page)break;await new Promise(resolve=>setTimeout(resolve,250));}
assert.ok(page,`必须连接隔离的 Tauri 宿主（${appUrl}，CDP ${cdpUrl}）`);
const errors=[],resources=[],passed=[],layouts=[];
page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});page.on("response",response=>{if(response.status()>=400)resources.push({url:response.url(),status:response.status()});});
const invoke=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const active=async()=>(await invoke("library_manage",{request:{action:"list"}})).active;
const store=async request=>{const lib=await active();return invoke("library_store",{libraryRoot:lib.path,librarySession:lib.session,request});};
const until=async(work,label)=>{const end=Date.now()+20000;while(Date.now()<end){const result=await work();if(result)return result;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`timeout: ${label}`);};
const panel=()=>page.getByRole("dialog",{name:"管理收藏集",exact:true});
const idle=()=>page.waitForFunction(()=>window.__ceasFilePhase?.()==="idle",null,{timeout:60000});
const close=async()=>{await panel().getByRole("button",{name:"关闭",exact:true}).click();await panel().waitFor({state:"hidden"});};
const entry=path=>panel().locator(".file-issue").filter({has:page.getByText(path,{exact:true})});
const preview=async()=>{await panel().getByRole("button",{name:"预览操作",exact:true}).click();await panel().getByText(/确认前不移动文件/u).waitFor();await until(()=>panel().getByRole("button",{name:"关闭",exact:true}).isEnabled(),"preview ready");};
const confirm=async label=>{await panel().getByRole("button",{name:label,exact:true}).click();await panel().getByRole("button",{name:label,exact:true}).waitFor({state:"hidden"});await until(()=>panel().getByRole("button",{name:"关闭",exact:true}).isEnabled(),"operation settled");};
try{
 await page.reload({waitUntil:"networkidle"});assert.equal((await active()).path.replaceAll("\\","/"),report.root.replaceAll("\\","/"));assert.equal(await page.evaluate(()=>typeof window.__nativeInvoke),"undefined");await idle();
 if(!(await store({action:"collections",trash:true})).some(row=>row.id===report.parentId)){
  const existing=(await store({action:"collections"})).find(row=>row.id===report.parentId);assert.ok(existing);
  const p=await store({action:"directory_preview",id:existing.id,kind:"trash"});await store({action:"directory_begin",id:existing.id,kind:"trash",task_id:`019a0000-0000-7000-8000-${Date.now().toString(16).padStart(12,"0")}`,expected:p.original,token:p.token});await page.reload({waitUntil:"networkidle"});await idle();
 }
 await page.getByRole("button",{name:"回收站",exact:true}).click();await page.getByText("已回收 1 个收藏集",{exact:true}).waitFor();await page.getByRole("button",{name:/^收藏集回收站/u}).click();
 const trashed=(await store({action:"collections",trash:true})).find(row=>row.id===report.parentId);assert.ok(trashed);
 await entry(trashed.path).getByRole("button",{name:"预览恢复收藏集",exact:true}).click();await preview();await page.screenshot({path:".cache/shots/collection-native-restore.png"});await confirm("确认恢复收藏集，保留双方");
 const restored=(await store({action:"collections"})).find(row=>row.id===report.parentId);assert.ok(restored);assert.equal(readFileSync(join(report.root,restored.path,"子集/a.txt"),"utf8"),"original A");assert.equal((await store({action:"list"})).find(row=>row.id===report.itemId).collection_id,report.childId);await close();passed.push("真实 Tauri 冷启动、收藏集回收站预览与恢复保持原件、父子身份和素材归属");
 await page.locator(`.rail-item[data-folder][title="${restored.path}"]`).click();await page.waitForFunction(()=>document.querySelectorAll(".cell").length===3);await idle();await page.getByRole("button",{name:"管理收藏集",exact:true}).click();
 await entry(restored.path).getByRole("button",{name:"改名或移动",exact:true}).click();const target=`任务恢复/原生改名-${Date.now().toString(36)}`;await panel().getByLabel("目标相对位置",{exact:true}).fill(target);await preview();await confirm("确认改名或移动");assert.ok(existsSync(join(report.root,target,"空集")));assert.equal((await store({action:"collections"})).find(row=>row.id===report.parentId).path,target);await close();await page.locator(`.rail-item[data-folder][title="${target}"][data-active]`).waitFor();passed.push("真实原生目录改名/移动，空目录和当前侧栏选择保持，生产 IPC 无桥接");
 await idle();await page.getByRole("button",{name:"管理收藏集",exact:true}).click();await entry(target).getByRole("button",{name:"回收整个收藏集",exact:true}).click();await preview();await page.screenshot({path:".cache/shots/collection-native-trash.png"});await panel().getByRole("button",{name:"取消本次操作",exact:true}).click();assert.ok(existsSync(join(report.root,target)));
 for(const theme of ["light","dark"])for(const density of ["compact","standard","airy"]){await page.evaluate(({theme,density})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.density=density;},{theme,density});const state=await panel().evaluate(element=>({overflow:element.scrollWidth>element.clientWidth,focusInside:element.contains(document.activeElement)}));assert.equal(state.overflow,false);assert.equal(state.focusInside,true);layouts.push({theme,density,...state});}
 await page.screenshot({path:".cache/shots/collection-native-dark-airy.png"});await page.evaluate(()=>{document.documentElement.dataset.theme="light";document.documentElement.dataset.density="standard";});await page.keyboard.press("Escape");await panel().waitFor({state:"hidden"});await page.waitForFunction(()=>document.activeElement?.textContent?.includes("管理收藏集"));passed.push("回收预览取消无移动，明暗三密度无溢出，键盘焦点约束与 Esc 回焦通过");
 await assert.rejects(store({action:"directory_preview",id:report.parentId,kind:"move",target:"../escape"}));await assert.rejects(store({action:"directory_preview",id:report.parentId,kind:"move",target:`${target}/self`}));assert.ok(!existsSync(join(report.base,"escape")));passed.push("原生边界拒绝路径穿越与目录移入自身，无库外副作用");
 assert.deepEqual(errors,[]);assert.deepEqual(resources,[]);const result={native:true,passed,layouts,errors,resources,root:report.root,runtime:report.runtime};writeFileSync(".cache/tmp/collections-native-latest.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){console.error({passed,errors,resources});await page.screenshot({path:".cache/shots/collection-native-error.png"}).catch(()=>{});throw error;}
finally{await browser.close();}
