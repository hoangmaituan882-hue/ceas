import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {mkdirSync,readFileSync,writeFileSync,existsSync,renameSync,cpSync} from "node:fs";
import {resolve,join} from "node:path";
import {chromium} from "playwright";
import {DatabaseSync} from "node:sqlite";
const base=resolve(".cache/tmp",`library-management-${Date.now()}`),parent=join(base,"libraries"),runtime=join(base,"runtime"),destination=join(base,"destination");
for(const directory of [parent,runtime,destination])mkdirSync(directory,{recursive:true});
const child=spawn(resolve("src-tauri/target/debug/ceas-store-probe.exe"),[],{windowsHide:true,env:{...process.env,CEAS_CONFIG_DIR:runtime},stdio:["pipe","pipe","inherit"]});
const waiting=[];createInterface({input:child.stdout}).on("line",line=>{const next=waiting.shift();if(!next)return;try{const result=JSON.parse(line);if(result.error)next.reject(new Error(result.error));else next.resolve(result.ok);}catch(error){next.reject(error);}});
child.on("exit",code=>{for(const next of waiting.splice(0))next.reject(new Error(`probe exit ${code}`));});
const rpc=(command,args={})=>new Promise((resolve,reject)=>{waiting.push({resolve,reject});child.stdin.write(`${JSON.stringify({command,args})}\n`);});
const manage=request=>rpc("library_manage",{request});
const current=async()=>(await manage({action:"list"})).active;
const store=async request=>{const active=await current();return rpc("library_store",{libraryRoot:active.path,librarySession:active.session,request});};
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checked=[],picks=[];
page.on("pageerror",error=>errors.push(error.message));page.on("console",msg=>{if(msg.type()==="error")errors.push(msg.text());});
await page.exposeBinding("__nativeInvoke",async(_origin,command,args)=>{
 if(command==="plugin:dialog|open"){assert.ok(picks.length,"unexpected folder picker");return picks.shift();}
 if(command==="reveal_in_explorer")return null;
 if(command==="copy_library_file"&&copyDelay)await new Promise(resolve=>setTimeout(resolve,copyDelay));
 return rpc(command,args);
});
await page.addInitScript(()=>{window.__TAURI_INTERNALS__={invoke:(command,args)=>window.__nativeInvoke(command,args)};});
let copyDelay=0;
const manager=()=>page.getByRole("region",{name:"资料库管理",exact:true});
const openManager=async()=>{if(!await manager().count())await page.getByRole("button",{name:"管理资料库",exact:true}).click();};
const returnWorkspace=async()=>{if(await manager().count())await page.getByRole("button",{name:"返回当前资料库",exact:true}).click();await manager().waitFor({state:"hidden"});};
const count=number=>page.waitForFunction(n=>document.querySelectorAll(".cell").length===n,number);
const create=async(name,folder=parent,adopt=false,guided=false)=>{
 await page.getByRole("button",{name:/^新建资料库/u}).click();await page.getByLabel("资料库名称",{exact:true}).fill(name);
 if(adopt)await page.getByLabel("使用已有普通文件夹，原地建立索引").check();
 picks.push(folder);await page.getByRole("button",{name:"选择文件夹",exact:true}).click();await page.getByRole("button",{name:"创建并打开",exact:true}).click();
 if(guided){await page.getByRole("heading",{name:"收藏集就是普通文件夹",exact:true}).waitFor();await page.getByRole("button",{name:"结束引导",exact:true}).click();}
 await manager().waitFor({state:"hidden"});
};
try{
 await page.goto(process.env.APP_URL??"http://127.0.0.1:5174",{waitUntil:"networkidle"});
 await page.getByRole("heading",{name:"给灵感一个位置",exact:true}).waitFor();await page.screenshot({path:".cache/shots/library-welcome.png"});
 await page.getByRole("button",{name:"稍后设置",exact:true}).click();await page.getByRole("heading",{name:"尚未打开资料库"}).waitFor();assert.equal((await manage({action:"list"})).libraries.length,0);checked.push("首启吉祥物、全部跳过和未配置管理页，不隐式建立资料库");
 await manage({action:"guide",step:0,done:false});await page.reload({waitUntil:"networkidle"});await create("参考 A",parent,false,true);const a=await current();assert.ok(existsSync(join(a.path,".ceas/library.db")));assert.ok(!existsSync(join(a.path,"ceas.db")));
 checked.push("首次建库激活后继续显示引导，可结束后进入有效工作区");
 checked.push("自定义库名和路径，显式创建统一辅助目录并进入真实工作区");
 const image=await page.evaluate(async()=>{const canvas=document.createElement("canvas");canvas.width=320;canvas.height=240;const ctx=canvas.getContext("2d");ctx.fillStyle="red";ctx.fillRect(0,0,160,240);ctx.fillStyle="blue";ctx.fillRect(160,0,160,240);return canvas.toDataURL("image/png").split(",")[1];});
 writeFileSync(join(a.path,"原件.png"),Buffer.from(image,"base64"));mkdirSync(join(a.path,"空收藏集"));
 await page.getByRole("button",{name:"设置",exact:true}).click();await page.getByRole("button",{name:"重新扫描电脑文件夹",exact:true}).click();await count(1);
 const item=(await store({action:"list"}))[0];assert.equal(item.hash.length,64);await page.locator(".cell").dblclick();await page.getByLabel("描述",{exact:true}).fill("迁移后保留的说明");await page.getByLabel("评分",{exact:true}).selectOption("4");await page.getByRole("button",{name:"保存元数据",exact:true}).click();await page.getByText("已保存",{exact:true}).waitFor();await page.keyboard.press("Escape");await page.locator(".overlay").waitFor({state:"hidden"});
 checked.push("真实文件重扫与完整哈希，元数据编辑保存到本库");
 await openManager();await page.locator(".library-card[data-current]").getByRole("button",{name:"修改名称",exact:true}).click();await page.getByLabel("显示名称",{exact:true}).fill("工作参考");await page.getByRole("button",{name:"保存名称",exact:true}).click();await manager().getByText("工作参考",{exact:true}).waitFor();assert.ok(existsSync(a.path));assert.equal((await current()).id,a.id);
 checked.push("修改显示名保留库身份和原目录");
 await create("参考 B");const b=await current();assert.notEqual(a.id,b.id);await count(0);await openManager();
 const cardA=page.locator("article.library-card").filter({has:page.getByText("工作参考",{exact:true})});await cardA.getByRole("button",{name:"打开",exact:true}).click();await manager().waitFor({state:"hidden"});await count(1);assert.equal((await current()).id,a.id);checked.push("多个库跨会话切换，独立素材和状态不串库");
 await openManager();await page.locator(".library-card[data-current]").getByRole("button",{name:"迁移位置",exact:true}).click();picks.push(destination);await page.getByRole("button",{name:"选择新位置",exact:true}).click();await page.getByRole("button",{name:"开始迁移",exact:true}).click();await page.getByRole("heading",{name:"你的资料库",exact:true}).waitFor();
 const moved=await current();assert.notEqual(moved.path,a.path);assert.equal(moved.id,a.id);assert.ok(existsSync(join(a.path,"原件.png")));assert.ok(existsSync(join(moved.path,"空收藏集")));assert.equal((await store({action:"list"}))[0].description,"迁移后保留的说明");
 await page.screenshot({path:".cache/shots/library-moved.png"});checked.push("迁移复制并校验、启用新位置、保留原副本和空收藏集及元数据");
 await page.locator(".library-card[data-current]").getByRole("button",{name:"修改名称",exact:true}).click();await page.getByLabel("显示名称",{exact:true}).fill("改名后的资料库");await page.getByLabel("同时修改根文件夹名称",{exact:true}).check();await page.getByRole("button",{name:"保存名称",exact:true}).click();await page.getByRole("heading",{name:"你的资料库",exact:true}).waitFor();const renamed=await current();assert.ok(renamed.path.endsWith("改名后的资料库"));assert.ok(!existsSync(moved.path));assert.equal(renamed.id,a.id);checked.push("应用内根目录改名并更新登记，整理信息及稳定身份保留");
 const ordinary=join(base,"ordinary");mkdirSync(ordinary);writeFileSync(join(ordinary,"已有图片.png"),Buffer.from(image,"base64"));await create("原地管理",ordinary,true);await count(1);assert.ok(existsSync(join(ordinary,"已有图片.png")));assert.equal((await store({action:"list"})).length,1);checked.push("已有普通目录原地建索引并自动扫描，不复制或移动原件");
 await openManager();await page.getByRole("button",{name:"新手引导",exact:true}).click();await page.getByRole("heading",{name:"收藏集就是普通文件夹",exact:true}).waitFor();await page.getByRole("button",{name:"跳过此步",exact:true}).click();await page.getByRole("heading",{name:"用整理信息快速找到素材",exact:true}).waitFor();await page.getByRole("button",{name:"从头查看",exact:true}).click();await page.getByRole("heading",{name:"收藏集就是普通文件夹",exact:true}).waitFor();await page.getByRole("button",{name:"结束引导",exact:true}).click();await manager().waitFor({state:"hidden"});checked.push("后续重新打开引导、逐步跳过和从头查看，结束后保留工作区");
 const old=await current();await manage({action:"close"});const outside=join(base,"外部移动后的库");renameSync(old.path,outside);await page.reload({waitUntil:"networkidle"});await page.getByRole("heading",{name:"你的资料库",exact:true}).waitFor();assert.ok(!existsSync(old.path));const lost=page.locator("article.library-card").filter({has:page.getByText("原地管理",{exact:true})});picks.push(outside);await lost.getByRole("button",{name:"重新定位",exact:true}).click();await manager().waitFor({state:"hidden"});await count(1);assert.equal((await current()).id,old.id);assert.ok(!existsSync(old.path));checked.push("外部移动后的不可用列表与身份核验重新定位，没有误建旧路径空库");
 await openManager();picks.push(join(base,"plain"));mkdirSync(picks[0]);await page.getByRole("button",{name:"打开资料库",exact:true}).click();await page.getByRole("heading",{name:"新建资料库",exact:true}).waitFor();assert.ok(!existsSync(join(base,"plain/.ceas")));await page.getByRole("button",{name:"取消",exact:true}).click();assert.equal((await current()).id,old.id);checked.push("打开普通目录只进入明确建库预览，取消不创建或切换");
 const pixcall=join(base,"pixcall-source");mkdirSync(join(pixcall,".pixcall/database"),{recursive:true});mkdirSync(join(pixcall,"参考"));writeFileSync(join(pixcall,"参考/海报.png"),Buffer.from(image,"base64"));
 const sourceDb=join(pixcall,".pixcall/database/main.db"),db=new DatabaseSync(sourceDb);
 db.exec("create table entries(id integer primary key,parent_id integer,name text,kind integer,tags text,size integer,content_type text,is_deleted integer,description text,link text,rating integer,created_at text,updated_at text);create table tags(id integer,name text,group_id integer);create table tag_groups(id integer,name text,color text);insert into entries values(1,-1,'Pixcall',0,'',0,'',0,'','',0,null,null),(10,1,'参考',0,'',0,'',0,'','',0,null,null),(20,10,'海报.png',1,'|51|',1,'image/png',0,'导入描述','https://example.com',5,'2026-01-01 00:00:00','2026-01-02 00:00:00');insert into tags values(51,'极简',5);insert into tag_groups values(5,'风格','#ff0000');");db.close();const beforeDb=readFileSync(sourceDb);
 picks.push(pixcall);await page.getByRole("button",{name:"从 Pixcall 导入",exact:true}).click();await page.getByRole("button",{name:"新建目标资料库",exact:true}).click();await page.getByLabel("资料库名称",{exact:true}).fill("导入目标");picks.push(parent);await page.getByRole("button",{name:"选择文件夹",exact:true}).click();await page.getByRole("button",{name:"创建并打开",exact:true}).click();await manager().waitFor({state:"hidden"});await count(1);
 const imported=(await store({action:"list"}))[0];assert.equal(imported.description,"导入描述");assert.equal(imported.rating,5);assert.equal(imported.relative_path,"参考/海报.png");assert.deepEqual(readFileSync(sourceDb),beforeDb);checked.push("首启/管理入口 Pixcall 来源预览、新建目标库及跨挂载导入队列，元数据与源库保护通过");
 copyDelay=700;
 const queuedScan=await rpc("pixcall_scan",{root:pixcall});queuedScan.entries=Array.from({length:9},(_,i)=>({...queuedScan.entries[0],source_id:`queued-${i}`,name:`队列${i}.png`,rel_path:`参考/队列${i}.png`}));queuedScan.total=9;queuedScan.readable=9;
 await page.evaluate(scan=>window.__ceasImportPixcall(scan),queuedScan);await page.getByRole("button",{name:"管理资料库",exact:true}).click();
 const queuedCard=page.locator("article.library-card").filter({has:page.getByText("参考 B",{exact:true})});await queuedCard.getByRole("button",{name:"停止当前任务后打开",exact:true}).click();
 await manager().waitFor({state:"hidden"});await count(0);assert.equal((await current()).id,b.id);copyDelay=0;
 const importedRecord=(await manage({action:"list"})).libraries.find(r=>r.name==="导入目标");assert.ok(importedRecord.count>=1&&importedRecord.count<=10);
 checked.push("导入中停止后切换等待旧任务收尾，保留已完成内容并隔离新库");
 await page.reload({waitUntil:"networkidle"});await count(0);await openManager();await page.screenshot({path:".cache/shots/library-manager-ready.png"});assert.deepEqual(errors,[]);
 checked.push("重新加载恢复上次当前库、最近列表及状态，页面错误为零");
 const report={passed:checked,errors,base,runtime,a,b,current:await current()};writeFileSync(".cache/tmp/library-management-latest.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){console.error(JSON.stringify({checked,errors,base},null,2));await page.screenshot({path:".cache/shots/library-management-error.png"}).catch(()=>{});throw error;}
finally{await browser.close();child.kill();}
