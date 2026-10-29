import assert from "node:assert/strict";
import {readFileSync,writeFileSync,existsSync,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {chromium} from "playwright";

const report=JSON.parse(readFileSync(".cache/tmp/library-management-latest.json","utf8"));
assert.ok(resolve(report.base).startsWith(resolve(".cache/tmp")+"\\"),"只操作本轮合成测试库");
const run=Date.now(),destination=join(report.base,`native-destination-${run}`);mkdirSync(destination,{recursive:true});
let browser;
for(let attempt=0;attempt<40;attempt++){
 try{browser=await chromium.connectOverCDP((process.env.CDP_URL??"http://127.0.0.1:9223"));break;}
 catch(error){if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,250));}
}
let page;
for(let attempt=0;attempt<40;attempt++){
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith((process.env.APP_URL??"http://127.0.0.1:5174")));
 if(page)break;
 await new Promise(resolve=>setTimeout(resolve,250));
}
assert.ok(page,`只连接隔离的桌面测试窗口（${(process.env.APP_URL??"http://127.0.0.1:5174")}）`);
const errors=[],resources=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("console",m=>{if(m.type()==="error")errors.push({message:m.text(),location:m.location()});});
page.on("response",r=>{if(r.status()>=400)resources.push({url:r.url(),status:r.status()});});
try{
 await page.reload({waitUntil:"networkidle"});
 await page.getByRole("button",{name:"管理资料库",exact:true}).waitFor();
 const evidence=await page.evaluate(async({report,destination,run})=>{
  if(!window.__TAURI_INTERNALS__)throw new Error("没有真实 Tauri 运行时");
  const invoke=(command,args)=>window.__TAURI_INTERNALS__.invoke(command,args);
  const manage=request=>invoke("library_manage",{request});
  const initial=(await manage({action:"list"})).active;
  if(initial.id!==report.b.id)throw new Error("未恢复本轮隔离资料库");
  let failedOpen=false,stale=false;
  try{await manage({action:"open",path:`${report.base}/native-missing`});}catch{failedOpen=true;}
  if((await manage({action:"list"})).active.session!==initial.session)throw new Error("失败打开替换了当前会话");
  try{await invoke("library_store",{libraryRoot:initial.path,librarySession:report.b.session,request:{action:"list"}});}catch{stale=true;}
  const a=(await manage({action:"list"})).libraries.find(r=>r.id===report.a.id);
  const active=await manage({action:"open",path:a.path});
  const newId=()=>{const random=crypto.randomUUID();return `${Date.now().toString(16).padStart(12,"0").slice(0,8)}-${Date.now().toString(16).slice(-4)}-7${random.slice(15,18)}-${random.slice(19,23)}-${random.slice(24)}`;};
  const args={libraryRoot:active.path,librarySession:active.session};
  const rows=await invoke("library_store",{...args,request:{action:"list"}});
  if(rows[0]?.description!=="迁移后保留的说明")throw new Error("原生打开丢失整理信息");
  await invoke("create_library_folder",{...args,relativePath:"真实窗口验证"});
  await invoke("library_store",{...args,request:{action:"ensure_collections",entries:[{id:newId(),path:"真实窗口验证"}]}});
  const path=await invoke("copy_library_file",{...args,source:`${active.path}/${rows[0].relative_path}`,relativePath:"真实窗口验证/原名.png",hash:rows[0].hash});
  const original=await invoke("load_blob",{...args,relativePath:rows[0].relative_path});
  const copy=await invoke("load_blob",{...args,relativePath:path});
  let badHash=false;try{await invoke("copy_library_file",{...args,source:`${active.path}/${path}`,relativePath:"真实窗口验证/错误校验.png",hash:"0".repeat(64)});}catch{badHash=true;}
  const scan=await invoke("scan_library_files",args);
  const moved=await invoke("move_library_item",{...args,id:rows[0].id,taskId:newId(),relativePath:"真实窗口验证/整理.png"});
  await invoke("move_library_item",{...args,id:rows[0].id,taskId:newId(),relativePath:rows[0].relative_path});
  const folder=`native-renamed-${run}`,target=`${destination}/${folder}`;
  await manage({action:"rename",id:active.id,name:"原生窗口验证库",folder_name:folder,task_id:newId()});
  const renamed=(await manage({action:"list"})).active;
  await manage({action:"move",id:active.id,target,task_id:newId()});
  const migrated=(await manage({action:"list"})).active;
  const catalog=await invoke("export_library_catalog",{libraryRoot:migrated.path,librarySession:migrated.session});
  const task=await manage({action:"task"});
  await manage({action:"open",path:initial.path});
  return {native:true,failedOpen,stale,badHash,copied:original===copy,scanned:scan.entries.some(e=>e.rel_path===path),moved:moved==="真实窗口验证/整理.png",identity:renamed.id===active.id&&migrated.id===active.id,source:renamed.path,target:migrated.path,catalog,phase:task.phase};
 },{report,destination,run});
 for(const key of ["native","failedOpen","stale","badHash","copied","scanned","moved","identity"])assert.equal(evidence[key],true,key);
 assert.equal(evidence.phase,"completed");assert.ok(existsSync(evidence.source));assert.ok(existsSync(evidence.target));assert.ok(existsSync(evidence.catalog));assert.ok(!existsSync(join(report.base,"native-missing")));
 await page.reload({waitUntil:"networkidle"});
 await page.getByRole("button",{name:"管理资料库",exact:true}).click();
 await page.getByRole("heading",{name:"你的资料库",exact:true}).waitFor();
 await page.screenshot({path:".cache/shots/library-native-ready.png"});
 const layouts=[];
 for(const theme of ["light","dark"])for(const density of ["compact","standard","airy"]){
  const layout=await page.evaluate(({theme,density})=>{
   document.documentElement.dataset.theme=theme;document.documentElement.dataset.density=density;
   const panel=document.querySelector(".library-space"),card=document.querySelector(".library-card");
   return {theme,density,overflow:panel.scrollWidth>panel.clientWidth,font:getComputedStyle(card).fontSize};
  },{theme,density});
  assert.equal(layout.overflow,false,JSON.stringify(layout));layouts.push(layout);
 }
 await page.screenshot({path:".cache/shots/library-native-dark-airy.png"});
 await page.evaluate(()=>{document.documentElement.dataset.theme="light";document.documentElement.dataset.density="standard";});
 await page.keyboard.press("Escape");await page.getByRole("region",{name:"资料库管理",exact:true}).waitFor({state:"hidden"});
 assert.equal(await page.getByRole("button",{name:"管理资料库",exact:true}).evaluate(button=>document.activeElement===button),true,"退出管理页回焦入口");
 assert.deepEqual(errors,[]);assert.deepEqual(resources,[]);
 const result={...evidence,layouts,keyboardFocus:true,errors,resources};writeFileSync(".cache/tmp/library-native-latest.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
