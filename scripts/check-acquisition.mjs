import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {mkdirSync,writeFileSync,readFileSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {performance} from "node:perf_hooks";
import {chromium} from "playwright";
const base=resolve(".cache/tmp",`acquisition-${Date.now()}`),root=join(base,"library"),runtime=join(base,"runtime"),source=join(base,"source");mkdirSync(runtime,{recursive:true});mkdirSync(source);
let sequence=50000;const id=()=>`019a0000-0000-7000-8000-${(++sequence).toString(16).padStart(12,"0")}`;
const child=spawn(resolve("src-tauri/target/debug/ceas-store-probe.exe"),[],{windowsHide:true,env:{...process.env,CEAS_CONFIG_DIR:runtime},stdio:["pipe","pipe","inherit"]});
const waiting=[];createInterface({input:child.stdout}).on("line",line=>{const next=waiting.shift();if(next){const value=JSON.parse(line);value.error?next.reject(new Error(value.error)):next.resolve(value.ok);}});
const rpc=(command,args={})=>new Promise((resolve,reject)=>{waiting.push({resolve,reject});child.stdin.write(`${JSON.stringify({command,args})}\n`);});
const manage=request=>rpc("library_manage",{request});await manage({action:"create",path:root,id:id(),name:"采集验证",existing:false});await manage({action:"guide",step:2,done:true});
const active=async()=>(await manage({action:"list"})).active;
const store=async request=>{const lib=await active();return rpc("library_store",{libraryRoot:lib.path,librarySession:lib.session,request});};
const rows=()=>store({action:"list"});
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1.5}),page=await context.newPage();
const errors=[],passed=[];page.on("pageerror",error=>errors.push(error.message));
await page.exposeBinding("__nativeInvoke",(_origin,command,args)=>rpc(command,args));
await page.addInitScript(()=>{
 const callbacks=new Map(),listeners=new Map();let next=0;
 window.__clipboardPaths=[];
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_event,id)=>listeners.delete(id)};
 window.__TAURI_INTERNALS__={metadata:{currentWebview:{label:"main"},currentWindow:{label:"main"}},transformCallback:callback=>{callbacks.set(++next,callback);return next;},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args)=>{
  if(command==="plugin:event|listen"){const id=++next;listeners.set(id,args);return id;}
  if(command==="plugin:event|unlisten"){listeners.delete(args.eventId);return;}
  if(command==="clipboard_file_paths")return window.__clipboardPaths;
  return window.__nativeInvoke(command,args);
 }};
 window.__drop=(type,paths,x,y)=>{const event=`tauri://drag-${type}`;for(const [id,listener]of listeners)if(listener.event===event)callbacks.get(listener.handler)?.({event,id,payload:{paths,position:{x:x*devicePixelRatio,y:y*devicePixelRatio}}});};
 window.__listeners=()=>listeners.size;
});
const until=async(work,label)=>{const end=Date.now()+30000;while(Date.now()<end){if(await work())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`timeout ${label}`);};
const idle=()=>page.waitForFunction(()=>window.__ceasFilePhase?.()==="idle"&&document.querySelector(".app")?.getAttribute("aria-busy")!=="true",null,{timeout:60000});
const drop=async(paths,selector=".content")=>{await idle();const box=await page.locator(selector).first().boundingBox();assert.ok(box);await page.evaluate(({paths,x,y})=>{window.__drop("enter",paths,x,y);},{paths,x:box.x+box.width/2,y:box.y+box.height/2});await page.locator(".acquisition-status").waitFor();await page.evaluate(({paths,x,y})=>window.__drop("drop",paths,x,y),{paths,x:box.x+box.width/2,y:box.y+box.height/2});};
const paste=async(paths)=>{await idle();await page.evaluate(paths=>{window.__clipboardPaths=paths;},paths);await page.locator(".content").click({position:{x:5,y:5}});await page.keyboard.press("Control+v");};
try{
 await page.goto(process.env.APP_URL??"http://127.0.0.1:5174",{waitUntil:"networkidle"});await page.waitForFunction(()=>window.__listeners?.()===4);await idle();
 const pngs=await page.evaluate(()=>["red","green","blue","yellow","purple","orange"].map(color=>{const canvas=document.createElement("canvas");canvas.width=8;canvas.height=8;const ctx=canvas.getContext("2d");ctx.fillStyle=color;ctx.fillRect(0,0,8,8);return canvas.toDataURL("image/png").split(",")[1];}));
 for(let i=0;i<3;i++)writeFileSync(join(source,`${i}.png`),Buffer.from(pngs[i],"base64"));
 await drop([0,1,2].map(i=>join(source,`${i}.png`)));await until(async()=>(await rows()).length===3,"root files imported");for(let i=0;i<3;i++)assert.ok(existsSync(join(root,`${i}.png`)));passed.push("全部素材拖入三张真实 PNG，原件进入库根并可读取");
 mkdirSync(join(source,"海报/子/空集"),{recursive:true});writeFileSync(join(source,"海报/子/a.txt"),"nested A");writeFileSync(join(source,"海报/.hidden.txt"),"normal hidden");
 await drop([join(source,"海报")]);await until(async()=>(await rows()).length===5,"folder imported");assert.ok(existsSync(join(root,"海报/子/空集")));assert.ok(existsSync(join(root,"海报/.hidden.txt")));await until(()=>page.locator('.rail-item[title="海报"]').count(),"sidebar folder");assert.equal(await page.locator('.rail-item').filter({hasText:/^收件箱3$/}).count(),1);passed.push("拖入目录保留子集、空集和普通隐藏文件，收件箱计数保持三张");
 await page.locator('.rail-item[title="海报"]').click();writeFileSync(join(source,"current.txt"),"current folder");await drop([join(source,"current.txt")]);await until(()=>existsSync(join(root,"海报/current.txt")),"current destination");passed.push("当前收藏集成为主区域的拖入落点");
 mkdirSync(join(source,"第二个/空"),{recursive:true});writeFileSync(join(source,"第二个/a.txt"),"child");await drop([join(source,"第二个")]);await until(()=>existsSync(join(root,"海报/第二个/a.txt")),"nested folder target");assert.ok(existsSync(join(root,"海报/第二个/空")));await idle();passed.push("收藏集内拖入目录继续保留层级");
 await page.keyboard.press("Control+k");const search=page.getByRole("searchbox",{name:"搜索素材"});await search.fill("a.txt");await page.keyboard.press("Escape");writeFileSync(join(source,"query.txt"),"query root");await drop([join(source,"query.txt")]);await until(()=>existsSync(join(root,"query.txt")),"query destination");assert.ok(!existsSync(join(root,"海报/query.txt")));passed.push("有查询条件时落回收件箱，不把筛选结果当作磁盘归属");
 writeFileSync(join(source,"sidebar.txt"),"sidebar");await drop([join(source,"sidebar.txt")],'.rail-item[title="海报/子"]');await until(()=>existsSync(join(root,"海报/子/sidebar.txt")),"sidebar destination");passed.push("侧栏指定收藏集覆盖当前位置与查询，系统缩放坐标正确");
 await page.keyboard.press("Control+k");await search.fill("");await page.keyboard.press("Escape");await page.locator('.rail-item[title="海报"]').click();writeFileSync(join(source,"paste.txt"),"clipboard");await paste([join(source,"paste.txt")]);await until(()=>existsSync(join(root,"海报/paste.txt")),"clipboard files");passed.push("Ctrl+V 复用当前收藏集路径导入（剪贴板路径为受控注入）");
 await page.keyboard.press("Control+k");await search.fill("editing");await page.evaluate(paths=>{window.__clipboardPaths=paths;},[join(source,"query.txt")]);const before=(await rows()).length;await page.keyboard.press("Control+v");await page.waitForTimeout(400);assert.equal((await rows()).length,before);await page.keyboard.press("Escape");passed.push("输入框粘贴不穿透为素材导入");
 await idle();await page.getByRole("button",{name:"回收站",exact:true}).click();await drop([join(source,"0.png")]);await page.getByText("回收站不能导入",{exact:true}).waitFor();assert.equal((await rows()).length,before);passed.push("回收站拒绝拖入且无磁盘或记录写入");
 await page.getByRole("navigation",{name:"位置",exact:true}).getByRole("button",{name:"采集验证",exact:true}).click();await idle();
 // 同名目录不合并已有内容；直接命中侧栏，以免上一个场景的查询影响目标。
 await drop([join(source,"海报")],'.rail-item[title="海报"]');await until(()=>existsSync(join(root,"海报/海报/子/a.txt")),"nested copy first");
 await drop([join(source,"海报")],'.rail-item[title="海报"]');await until(()=>existsSync(join(root,"海报/海报 (1)/子/a.txt")),"nested copy collision");assert.equal(readFileSync(join(root,"海报/海报/子/a.txt"),"utf8"),"nested A");passed.push("同名目录保留双方，原目录与来源均保留");
 writeFileSync(join(source,"broken.png"),"broken image");await drop([join(source,"broken.png")],'.rail-item[title="海报"]');await until(()=>page.locator('.query-summary').filter({hasText:"个文件和库不一致"}).count(),"import failure");await page.getByRole("button",{name:"查看",exact:true}).click();await page.getByRole("button",{name:"重试导入此文件",exact:true}).waitFor();writeFileSync(join(source,"broken.png"),Buffer.from(pngs[4],"base64"));await page.getByRole("button",{name:"重试导入此文件",exact:true}).click();await until(()=>existsSync(join(root,"海报/broken.png")),"retry source");await until(async()=>(await rows()).some(row=>row.relative_path==="海报/broken.png"),"retry database");await page.getByRole("dialog",{name:"文件问题",exact:true}).getByRole("button",{name:"关闭",exact:true}).click();passed.push("解码失败进入问题面板，修复来源后原目标单文件重试成功");
 const bench=join(base,"scan-benchmark");mkdirSync(bench);for(let i=0;i<3000;i++)writeFileSync(join(bench,`${i}.txt`),`synthetic ${i}`);const lib=await active();
 const started=performance.now();const scan=await rpc("prepare_acquisition",{libraryRoot:lib.path,librarySession:lib.session,paths:[bench],target:""});const scanMs=performance.now()-started;assert.equal(scan.sources.length,3000);assert.ok(scan.warnings.length===0);passed.push("3000 个合成文件的目录准备清单完整，记录读盘耗时");
 await page.screenshot({path:".cache/shots/acquisition-result.png"});assert.deepEqual(errors,[]);
 const report={base,root,runtime,passed,errors,scanBenchmark:{files:3000,ms:scanMs,synthetic:true},nativeDrop:"controlled Tauri event payload, real Rust file/SQLite",clipboard:"controlled paths; Windows CF_HDROP separately requires native check"};writeFileSync(".cache/tmp/acquisition-latest.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:".cache/shots/acquisition-failed.png"}).catch(()=>{});throw error;}finally{await browser.close();child.stdin.end();}
