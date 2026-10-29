import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const base=resolve(".cache/tmp",`primary-e2e-${Date.now()}`);
const a=join(base,"library-a"),b=join(base,"library-b");
mkdirSync(a,{recursive:true});mkdirSync(b,{recursive:true});mkdirSync(".cache/shots",{recursive:true});
const child=spawn(resolve("src-tauri/target/debug/ceas-store-probe.exe"),[],{windowsHide:true,stdio:["pipe","pipe","inherit"]});
const waiting=[];
createInterface({input:child.stdout}).on("line",line=>{
  const next=waiting.shift();if(!next)return;
  try{const value=JSON.parse(line);if(value.error)next.reject(new Error(value.error));else next.resolve(value.ok);}catch(error){next.reject(error);}
});
child.on("exit",code=>{for(const entry of waiting.splice(0))entry.reject(new Error(`native probe exited: ${code}`));});
const rpc=(message)=>new Promise((resolve,reject)=>{waiting.push({resolve,reject});child.stdin.write(`${JSON.stringify(message)}\n`);});
const store=(root,request)=>rpc({root,request});
let activeRoot=a,nextPick=b;
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();const errors=[];const checked=[];
const failedRequests=[];
page.on("requestfailed",request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText,stage:checked.at(-1)}));
page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
try{
  await page.goto(process.env.APP_URL??"http://127.0.0.1:5174",{waitUntil:"networkidle"});
  const legacy=await page.evaluate(async()=>{
    localStorage.clear();
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open("ceas");q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    const rows=[];
    for(const [id,color] of [["legacy-a","red"],["legacy-b","green"]]){
      const canvas=document.createElement("canvas");canvas.width=320;canvas.height=240;
      const ctx=canvas.getContext("2d");ctx.fillStyle=color;ctx.fillRect(0,0,320,240);
      const thumb=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      const bytes=await thumb.arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),value=>value.toString(16).padStart(2,"0")).join("").slice(0,32);
      rows.push({id,hash,name:`${id}.png`,w:320,h:240,bytes:bytes.byteLength,kind:"image",ext:"png",color:"rgb(255, 0, 0)",createdAt:1700000000000,thumb});
    }
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(["items","originals"],"readwrite");tx.objectStore("items").clear();tx.objectStore("originals").clear();
      for(const row of rows){tx.objectStore("items").put(row);tx.objectStore("originals").put({hash:row.hash,blob:row.id==="legacy-b"?new Blob(["damaged"]):row.thumb});}
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    localStorage.setItem("ceas.mode","library");localStorage.setItem("ceas.tags.v1",JSON.stringify({"legacy-a":["源标签"]}));
    const full=await rows[1].thumb.arrayBuffer();let bytes="";for(const value of new Uint8Array(full))bytes+=String.fromCharCode(value);
    db.close();
    return {rows:rows.map(({thumb,...row})=>({...row,created_at:row.createdAt})),second:btoa(bytes)};
  });
  await store(a,{action:"put",items:[legacy.rows[0]]});
  await page.exposeBinding("__nativeInvoke",async(_source,command,args={})=>{
    if(command==="library_info")return {path:activeRoot,exists:true,custom:true};
    if(command==="set_library_root"){activeRoot=args.path;await store(activeRoot,{action:"state"});return {path:activeRoot,exists:true,custom:true};}
    if(command==="plugin:dialog|open")return nextPick;
    if(command==="blob_count")return 0;
    if(args.libraryRoot&&args.libraryRoot!==activeRoot)throw new Error("资料库已切换，请重试当前操作");
    if(command==="library_store")return store(activeRoot,args.request);
    if(["save_blob","load_blob","blob_exists","copy_library_file","create_library_folder","scan_library_files","move_library_item","export_library_catalog","read_binary"].includes(command))return rpc({root:activeRoot,command,...args});
    throw new Error(`Unexpected native command: ${command}`);
  });
  await page.addInitScript(()=>{window.__TAURI_INTERNALS__={invoke:(command,args)=>window.__nativeInvoke(command,args)};});
  await page.reload({waitUntil:"networkidle"});
  await page.waitForFunction(()=>document.body.innerText.includes("原件校验失败"));
  assert.equal((await store(a,{action:"state"}))["legacy-v2-complete"],undefined);
  assert.equal((await store(a,{action:"stats"})).items,1);
  checked.push("坏原件阻止提交，迁移标记未写入，旧数据保留");
  await page.evaluate(async({hash,data})=>{
    const blob=new Blob([Uint8Array.from(atob(data),value=>value.charCodeAt(0))],{type:"image/png"});
    const db=await new Promise(resolve=>{const q=indexedDB.open("ceas");q.onsuccess=()=>resolve(q.result);});
    await new Promise((resolve,reject)=>{const tx=db.transaction("originals","readwrite");tx.objectStore("originals").put({hash,blob});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },{hash:legacy.rows[1].hash,data:legacy.second});
  await page.getByRole("button",{name:"重试",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===2);
  assert.equal((await store(a,{action:"state"}))["legacy-v2-complete"],"1");
  assert.deepEqual((await store(a,{action:"tags"}))["legacy-a"],["源标签"]);
  for(const row of legacy.rows){const bytes=readFileSync(join(a,"blobs",row.hash.slice(0,2),`${row.hash}.png`));assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0,32),row.hash);}
  checked.push("修复后重试成功，元数据/标签/完成标记原子提交，磁盘原件哈希核对通过");

  await page.locator('.cell[data-id="legacy-a"]').click({button:"right"});
  await page.locator(".ctx-parent").click();
  await page.getByRole("menuitem",{name:"添加标签…",exact:true}).click();
  await page.locator(".ctx-add input").fill("持久标签");await page.keyboard.press("Enter");
  await page.waitForFunction(()=>[...document.querySelectorAll('.ctx-tag[aria-checked="true"]')].some(el=>el.textContent.includes("持久标签")));
  await page.keyboard.press("Escape");
  assert.ok((await store(a,{action:"tags"}))["legacy-a"].includes("持久标签"));
  await page.evaluate(async()=>{
    const clear=async(name,stores)=>{const db=await new Promise(resolve=>{const q=indexedDB.open(name);q.onsuccess=()=>resolve(q.result);});await new Promise((resolve,reject)=>{const tx=db.transaction(stores,"readwrite");for(const store of stores)tx.objectStore(store).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();};
    await clear("ceas",["items"]);await clear("ceas-thumbnails",["thumbs"]);localStorage.removeItem("ceas.tags.v1");
  });
  await page.reload({waitUntil:"networkidle"});
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===2&&[...document.querySelectorAll(".thumb-img")].every(img=>img.complete&&img.naturalWidth>0));
  assert.ok((await store(a,{action:"tags"}))["legacy-a"].includes("持久标签"));
  const backupCount=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const q=indexedDB.open("ceas");q.onsuccess=()=>resolve(q.result);});return new Promise(resolve=>{const q=db.transaction("originals").objectStore("originals").count();q.onsuccess=()=>{db.close();resolve(q.result);};});});
  assert.equal(backupCount,2);
  checked.push("清空旧元数据与缩略图缓存后，仍从 SQLite+原件恢复列表和标签；原件备份保留");

  await page.locator('.cell[data-id="legacy-a"]').click({button:"right"});
  await page.getByRole("menuitem",{name:/^删除/}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===1);
  const db=new DatabaseSync(join(a,"ceas.db"),{readOnly:true});
  assert.ok(db.prepare("select deleted_seq from items where id='legacy-a'").get().deleted_seq>0);
  assert.ok(db.prepare("select count(*) as n from item_tags where item_id='legacy-a'").get().n>=2);db.close();
  assert.equal((await store(a,{action:"stats"})).items,2);
  await page.getByRole("button",{name:"撤销",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===2);
  assert.ok((await store(a,{action:"tags"}))["legacy-a"].includes("持久标签"));
  checked.push("删除仅写 deleted_seq，保留物理行/标签/原件，撤销恢复可见性");
  await store(a,{action:"delete",ids:["legacy-a"]});await page.reload({waitUntil:"networkidle"});
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===1);
  await page.getByRole("button",{name:"回收站",exact:true}).click();
  await page.locator('.cell[data-id="legacy-a"]').waitFor();
  await page.locator('.cell[data-id="legacy-a"]').click();await page.getByRole("button",{name:"恢复",exact:true}).click();
  await page.getByText("回收站为空",{exact:true}).waitFor();
  await page.getByRole("button",{name:"资料库",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===2);
  checked.push("删除后重启仍可从回收站恢复，恢复后保留原标签与素材身份");

  await page.getByRole("tab",{name:/^画布视图/}).click();await page.locator(".cv-item").first().waitFor();
  await page.waitForFunction(async root=>Boolean((await window.__nativeInvoke("library_store",{libraryRoot:root,request:{action:"state"}}))["ceas.board.v1"]),a);
  const board=(await store(a,{action:"state"}))["ceas.board.v1"];
  await page.keyboard.press("Control+k");await page.getByRole("searchbox",{name:"搜索素材"}).fill("legacy-a");await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"设置",exact:true}).click();
  nextPick=b;await page.getByRole("button",{name:"打开资料库…",exact:true}).click();
  await page.getByText("这里还空着",{exact:true}).waitFor();
  assert.equal(await page.locator(".cell,.cv-item").count(),0);
  assert.equal((await store(b,{action:"state"}))["ceas.board.v1"],undefined);
  assert.deepEqual(await store(b,{action:"tags"}),{});
  assert.equal(await page.locator(".query-summary").count(),0);
  checked.push("切到空库不复制旧数据，重置筛选/选择/视口/标签，画布状态按库隔离");
  await page.evaluate(async()=>{
    const canvas=document.createElement("canvas");canvas.width=100;canvas.height=100;canvas.getContext("2d").fillRect(0,0,100,100);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    const data=new DataTransfer();data.items.add(new File([blob],"b-only.png",{type:"image/png"}));
    document.querySelector(".app").dispatchEvent(new DragEvent("drop",{dataTransfer:data,bubbles:true,cancelable:true}));
  });
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===1);
  const bRows=await store(b,{action:"list"});assert.equal(bRows.length,1);
  assert.match(bRows[0].id,/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  await page.getByRole("button",{name:"设置",exact:true}).click();nextPick=a;
  await page.getByRole("button",{name:"打开资料库…",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cv-item").length===2);
  assert.equal((await store(a,{action:"state"}))["ceas.board.v1"],board);
  assert.equal((await store(a,{action:"stats"})).visible,2);
  await page.reload({waitUntil:"networkidle"});await page.waitForFunction(()=>document.querySelectorAll(".cv-item").length===2);
  checked.push("新导入只写目标库并使用 UUIDv7，切回和重启仍恢复各自素材与坐标");

  await page.getByRole("tab",{name:/^网格视图/}).click();activeRoot=b;
  await page.locator('.cell[data-id="legacy-a"]').click({button:"right"});await page.locator(".ctx-parent").click();
  await page.getByRole("menuitem",{name:"添加标签…",exact:true}).click();await page.locator(".ctx-add input").fill("不应写入");await page.keyboard.press("Enter");
  await page.waitForFunction(()=>document.body.innerText.includes("标签未保存"));
  assert.deepEqual(await store(b,{action:"tags"}),{});
  assert.ok(!(await store(a,{action:"tags"}))["legacy-a"].includes("不应写入"));
  activeRoot=a;await page.keyboard.press("Escape");await page.reload({waitUntil:"networkidle"});
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===2);
  checked.push("过期资料库写入被拒绝，界面显示错误，没有误写另一库或退回旧存储");
  await page.screenshot({path:".cache/shots/primary-ready.png"});
  assert.deepEqual(errors,[]);
  const report={passed:checked,errors,root:base,a,b,visibleA:(await store(a,{action:"stats"})).visible,visibleB:(await store(b,{action:"stats"})).visible};
  writeFileSync(".cache/tmp/primary-e2e-latest.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}catch(error){
  console.error(JSON.stringify({checked,failedRequests},null,2));
  await page.screenshot({path:".cache/shots/primary-failure.png"}).catch(()=>{});throw error;
}finally{await context.close();await browser.close();child.stdin.end();}
