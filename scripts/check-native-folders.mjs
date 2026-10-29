import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {chromium} from "playwright";
const report=JSON.parse(readFileSync(".cache/tmp/folder-e2e-latest.json","utf8"));
let browser;
for(let attempt=0;attempt<40;attempt++){try{browser=await chromium.connectOverCDP((process.env.CDP_URL??"http://127.0.0.1:9223"));break;}catch(error){if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}
const page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith((process.env.APP_URL??"http://127.0.0.1:5174")));
assert.ok(page,`只允许连接独立桌面测试窗口（${(process.env.APP_URL??"http://127.0.0.1:5174")}）`);
const errors=[],resourceErrors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error"){errors.push(message.text());resourceErrors.push({message:message.text(),location:message.location()});}});
page.on("response",response=>{if(response.status()>=400)resourceErrors.push({url:response.url(),status:response.status()});});
await page.waitForFunction(()=>document.querySelectorAll(".cell").length===4);
const result=await page.evaluate(async report=>{
  if(!window.__TAURI_INTERNALS__)throw new Error("不是真实桌面环境");
  const invoke=(command,args)=>window.__TAURI_INTERNALS__.invoke(command,args);
  const root=report.target,libraryRoot=root;
  const info=await invoke("library_info");if(info.path!==root)throw new Error("不是本轮隔离资料库");
  await invoke("create_library_folder",{libraryRoot,relativePath:"真实窗口验证"});
  const scan=await invoke("pixcall_scan",{root:report.source,limit:0});
  const source=scan.entries.find(entry=>entry.rel_path==="空间与材质/海报.png").path;
  const relative=await invoke("copy_library_file",{libraryRoot,source,relativePath:"真实窗口验证/原名.png"});
  const copied=await invoke("read_binary",{path:`${root}/${relative}`}),original=await invoke("read_binary",{path:source});
  const disk=await invoke("scan_library_files",{libraryRoot});
  const rows=await invoke("library_store",{libraryRoot,request:{action:"list"}}),item=rows.find(item=>item.relative_path==="待整理.png");
  const moved=await invoke("move_library_item",{libraryRoot,id:item.id,relativePath:"真实窗口验证/待整理.png"});
  const restored=await invoke("move_library_item",{libraryRoot,id:item.id,relativePath:"待整理.png"});
  const catalog=await invoke("export_library_catalog",{libraryRoot});
  let rejected=false;try{await invoke("library_store",{libraryRoot:report.source,request:{action:"list"}});}catch{rejected=true;}
  return {native:true,sourceEntries:scan.total,sourceReadable:scan.readable,copied:copied===original,
    scanned:disk.entries.some(entry=>entry.rel_path===relative),moved:moved==="真实窗口验证/待整理.png",restored:restored==="待整理.png",staleRejected:rejected,catalog};
},report);
for(const field of ["native","copied","scanned","moved","restored","staleRejected"])assert.equal(result[field],true,field);
assert.equal(result.sourceEntries,5);assert.equal(result.sourceReadable,4);
await page.reload({waitUntil:"networkidle"});await page.waitForFunction(()=>document.querySelectorAll(".cell").length===4);
await page.screenshot({path:".cache/shots/folder-native-ready.png"});assert.deepEqual(errors,[],JSON.stringify(resourceErrors));
const evidence={...result,errors,resourceErrors};writeFileSync(".cache/tmp/folder-native-latest.json",JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
await browser.close();
