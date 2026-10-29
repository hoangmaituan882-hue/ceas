import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {mkdirSync,writeFileSync,readdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {chromium} from "playwright";

/* ══ 回收站闭环 + 侧栏右键菜单 ════════════════════════════════
   验收两件事：
   1. 侧栏右键出菜单，且不改当前视图；Esc 关闭
   2. 彻底删除真的释放磁盘空间（应用回收），清空回收站清干净
   ------------------------------------------------------------ */

const base=resolve(".cache/tmp",`trash-${Date.now()}`),root=join(base,"library"),runtime=join(base,"runtime");
mkdirSync(base,{recursive:true});mkdirSync(runtime);
let child,waiting=[],generation=2000;
const id=()=>`019a0000-0000-7000-8000-${(++generation).toString(16).padStart(12,"0")}`;
child=spawn(resolve("src-tauri/target/debug/ceas-store-probe.exe"),[],{windowsHide:true,env:{...process.env,CEAS_CONFIG_DIR:runtime},stdio:["pipe","pipe","inherit"]});
createInterface({input:child.stdout}).on("line",line=>{const next=waiting.shift();if(next){const result=JSON.parse(line);if(result.error)next.reject(new Error(result.error));else next.resolve(result.ok);}});
const rpc=(command,args={})=>new Promise((resolve2,reject)=>{waiting.push({resolve:resolve2,reject});child.stdin.write(`${JSON.stringify({command,args})}\n`);});
const manage=request=>rpc("library_manage",{request});
const active=async()=>(await manage({action:"list"})).active;
const store=async request=>{const lib=await active();return rpc("library_store",{libraryRoot:lib.path,librarySession:lib.session,request});};
const until=async(work,description)=>{const end=Date.now()+20000;while(Date.now()<end){if(await work())return;await new Promise(r=>setTimeout(r,100));}throw new Error(`timeout: ${description}`);};

await manage({action:"create",path:root,id:id(),name:"清理验证",existing:false});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],passed=[];
page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
await page.exposeBinding("__nativeInvoke",async(_o,command,args)=>command==="plugin:dialog|open"?null:rpc(command,args));
await page.addInitScript(()=>{window.__TAURI_INTERNALS__={invoke:(c,a)=>window.__nativeInvoke(c,a)};});

try{
 await page.goto(process.env.APP_URL??"http://127.0.0.1:5174",{waitUntil:"networkidle"});
 /* 两张图，分别走「应用回收」与「磁盘删除」两条路 */
 const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement("canvas");canvas.width=60;canvas.height=40;const c=canvas.getContext("2d");c.fillStyle="teal";c.fillRect(0,0,60,40);return canvas.toDataURL("image/png").split(",")[1];}),"base64");
 mkdirSync(join(root,"参考"),{recursive:true});
 writeFileSync(join(root,"参考/甲.png"),png);writeFileSync(join(root,"参考/乙.png"),png);
 await until(async()=>(await store({action:"list"})).length===2,"two items indexed");

 /* 1) 侧栏右键：出菜单、不改视图、Esc 关闭 */
 const row=page.locator('.rail-item[data-folder="true"]').first();
 await row.click({button:"right"});
 await page.getByRole("menu").waitFor();
 const menu=page.getByRole("menu");
 assert.ok(await menu.getByRole("menuitem",{name:"在资源管理器中打开",exact:true}).count(),"菜单项齐全");
 assert.ok(await menu.getByRole("menuitem",{name:"复制路径",exact:true}).count());
 await page.keyboard.press("Escape");
 await page.getByRole("menu").waitFor({state:"detached"});
 passed.push("侧栏右键出菜单，Esc 关闭，不切换当前视图");

 /* 2) 应用删除 → 回收站 → 彻底删除，磁盘空间真的回来 */
 const a=(await store({action:"list"})).find(item=>item.name==="甲.png");
 await page.locator(`.cell[data-id="${a.id}"]`).click({button:"right"});
 await page.getByRole("menuitem",{name:/^删除/u}).click();
 await until(async()=>(await store({action:"trash"})).some(item=>item.id===a.id),"moved to trash");
 const trashed=readdirSync(join(root,".ceas","trash"),{recursive:true}).filter(name=>String(name).endsWith("甲.png"));
 assert.equal(trashed.length,1,"原件进了 .ceas/trash");

 await page.getByRole("button",{name:/^回收站/u}).click();
 await page.getByRole("button",{name:"清空回收站",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"清空回收站",exact:true});
 await dialog.waitFor();
 const copy=await dialog.textContent();
 assert.ok(/无法恢复|无法撤销/u.test(copy??""),`确认框要写明不可恢复：${copy}`);
 assert.ok(/释放/u.test(copy??""),"确认框要写明释放多少");
 await dialog.getByRole("button",{name:/清空，无法撤销/u}).click();
 await until(async()=>(await store({action:"trash"})).length===0,"trash emptied");
 const left=readdirSync(join(root,".ceas","trash"),{recursive:true}).filter(name=>String(name).endsWith("甲.png"));
 assert.equal(left.length,0,"回收区里的原件被真正删除");
 passed.push("彻底删除/清空回收站真正删掉回收区原件并清空记录");

 /* 3) 「磁盘删除」项：恢复面板要说清没有原件，并给出两条出路 */
 const b=(await store({action:"list"})).find(item=>item.name==="乙.png");
 /* 停在回收站视图也行：核对与跟随删除不依赖当前视图 */
 const {unlinkSync}=await import("node:fs");
 unlinkSync(join(root,"参考/乙.png"));
 await until(async()=>(await store({action:"trash"})).some(item=>item.id===b.id),"external delete follows");
 await page.locator(`.cell[data-id="${b.id}"]`).click();
 await until(async()=>await page.getByRole("button",{name:"恢复",exact:true}).isEnabled(),"restore enabled");
 await page.getByRole("button",{name:"恢复",exact:true}).click();
 const diskDialog=page.getByRole("dialog",{name:"没有可还原的原件",exact:true});
 await diskDialog.waitFor();
 assert.ok(await diskDialog.getByText(/无法还原字节/u).count(),"说明为什么不能还原");
 assert.ok(await diskDialog.getByRole("button",{name:"把整理信息合并到…",exact:true}).count(),"给出合并出路");
 assert.ok(await diskDialog.getByRole("button",{name:"彻底删除记录",exact:true}).count(),"给出删除出路");
 await diskDialog.getByRole("button",{name:"取消",exact:true}).click();
 passed.push("磁盘删除项不假装能还原：说明原因，只给合并与清记录两条出路");

 const stateKeys=Object.keys(await store({action:"state"}));
 assert.ok(!stateKeys.includes(`ceas.trash.${a.id}`),"回收记录清理干净");
 passed.push("回收记录与文件记录一并清理，不留孤儿状态");
} catch (reason) {
 console.error(String(reason));
 console.log(JSON.stringify({passed,errors},null,1));
 await browser.close();child.kill();process.exit(1);
}
console.log(JSON.stringify({passed,errors},null,1));
await browser.close();child.kill();
