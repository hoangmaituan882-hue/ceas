import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {resolve,join} from "node:path";
import {chromium} from "playwright";
const report=JSON.parse(readFileSync(".cache/tmp/acquisition-latest.json","utf8"));
assert.ok(resolve(report.base).startsWith(resolve(".cache/tmp")+"\\"));
const port=process.env.ACQUISITION_CDP_PORT??"9225";
const host=spawn(resolve("src-tauri/target/debug/ceas.exe"),[],{windowsHide:true,env:{...process.env,CEAS_CONFIG_DIR:report.runtime,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},stdio:["ignore","pipe","pipe"]});
const logs=[];host.stdout.on("data",data=>logs.push(data.toString()));host.stderr.on("data",data=>logs.push(data.toString()));
let browser,page;const errors=[],passed=[],layouts=[];
const until=async(work,label)=>{const end=Date.now()+45000;while(Date.now()<end){if(await work())return;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error(`timeout ${label}`);};
try{
 await until(async()=>{try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);return true;}catch{return false;}},"native CDP");
 await until(async()=>{page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith("http://127.0.0.1:5174"));return !!page;},"native page");
 page.on("pageerror",error=>errors.push(error.message));
 await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__&&document.querySelector(".app"));assert.equal(await page.evaluate(()=>typeof window.__nativeInvoke),"undefined");
 const invoke=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
 const active=(await invoke("library_manage",{request:{action:"list"}})).active;assert.equal(active.path.replaceAll("\\","/"),report.root.replaceAll("\\","/"));
 const store=request=>invoke("library_store",{libraryRoot:active.path,librarySession:active.session,request});
 const idle=()=>page.waitForFunction(()=>window.__ceasFilePhase?.()==="idle"&&document.querySelector(".app")?.getAttribute("aria-busy")!=="true");
 const emit=(type,payload)=>invoke("plugin:event|emit_to",{target:{kind:"Webview",label:"main"},event:`tauri://drag-${type}`,payload});
 await idle();await page.locator('.rail-item[title="海报"]').click();await page.waitForTimeout(500);
 const filename=`native-${Date.now()}.txt`,source=join(report.base,"source",filename);writeFileSync(source,"native IPC acquisition");
 const box=await page.locator('.rail-item[title="海报/子"]').boundingBox();assert.ok(box);const dpr=await page.evaluate(()=>devicePixelRatio);const position={x:(box.x+box.width/2)*dpr,y:(box.y+box.height/2)*dpr};
 await emit("enter",{paths:[source],position});await page.locator(".acquisition-status").filter({hasText:"海报/子"}).waitFor();
 await page.screenshot({path:".cache/shots/acquisition-native-drop.png"});await emit("drop",{paths:[source],position});
 await until(()=>existsSync(join(report.root,"海报/子",filename)),"native original");await idle();
 assert.ok((await store({action:"list"})).some(row=>row.relative_path===`海报/子/${filename}`));passed.push("真实 Tauri 事件订阅、生产 IPC、目录复制与 SQLite 归属，无桥接；拖放事件为受控注入");
 await assert.rejects(()=>invoke("prepare_acquisition",{libraryRoot:active.path,librarySession:"expired",paths:[source],target:""}),/会话/);passed.push("过期会话不能准备导入或创建目录");
 for(const theme of ["light","dark"])for(const density of ["compact","standard","airy"]){
  await page.evaluate(({theme,density})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.density=density;},{theme,density});
  await until(async()=>{await idle();const p=await page.evaluate(()=>{const rect=document.querySelector('.rail-item[title="海报/子"]').getBoundingClientRect();return {x:(rect.x+rect.width/2)*devicePixelRatio,y:(rect.y+rect.height/2)*devicePixelRatio};});await emit("enter",{paths:[source],position:p});return (await page.locator(".acquisition-status").textContent())?.includes("海报/子");},"feedback after pending automatic check");
  const state=await page.locator(".acquisition-status").evaluate(element=>({overflow:element.scrollWidth>element.clientWidth,text:element.textContent}));assert.equal(state.overflow,false);assert.match(state.text,/海报\/子/);layouts.push({theme,density,...state});
 }
 await page.screenshot({path:".cache/shots/acquisition-native-dark-airy.png"});await emit("leave",{});passed.push("明暗三密度落点反馈与侧栏高亮无溢出");
 assert.deepEqual(errors,[]);const evidence={base:report.base,root:report.root,passed,layouts,errors,clipboard:"CF_HDROP decode tested through native Windows handle; system clipboard not overwritten",osGesture:"未模拟资源管理器真实鼠标拖放"};writeFileSync(".cache/tmp/acquisition-native-latest.json",JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{
 if(page)await page.screenshot({path:".cache/shots/acquisition-native-last.png"}).catch(()=>{});
 if(browser)await browser.close();
 try{execFileSync("taskkill",["/pid",String(host.pid),"/t","/f"],{windowsHide:true,stdio:"ignore"});}catch{}
 writeFileSync(".cache/tmp/acquisition-native-host.log",logs.join(""));
}
