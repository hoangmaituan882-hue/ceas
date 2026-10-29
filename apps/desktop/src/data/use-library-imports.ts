import {ensureParent,ensureCollections} from "./collection-store";
import type {AcquisitionTarget} from "@ceas/core/acquisition";
import { useEffect,useMemo,useRef,useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { callStore,isDesktop,watchLibrary,fingerprintLibraryFile,prepareAcquisition,type PixcallEntry,type PixcallScan } from "./desktop";
import { importFiles,importSources,importUrls,type ImportHandle,type ImportProgress,type ImportSource } from "./importer";
import { createRepository } from "./db";
import { preparePixcallImport } from "./pixcall-import";
import { useLibraryContext } from "./library-context";
import { associateFile,acceptContent as acceptFileContent,coordinateFiles,fileTasks,relocateCollection as relocateCollectionFolder,INITIAL_FILE_STATUS,type FileStatus,type FileIssue } from "./file-coordinator";
export function useLibraryImports(refresh:()=>Promise<void>,reportError:(reason:unknown)=>void,notify:(text:string)=>void,suspendChecks=false){
 const manager=useLibraryContext(),repository=useMemo(createRepository,[]),alive=useRef(true),stopRequested=useRef(false);
 const [imp,setImp]=useState<ImportProgress|null>(null),[impPaused,setImpPaused]=useState(false),[preparing,setPreparing]=useState(false),[fileStatus,setFileStatus]=useState<FileStatus>(INITIAL_FILE_STATUS);
 const handle=useRef<ImportHandle|null>(null),preparingRef=useRef(false),sharedBusy=useRef(false),suspended=useRef(false);sharedBusy.current=manager?.importing??false;suspended.current=suspendChecks;
 const acquisitionIssues=useRef(new Map<string,{issue:FileIssue;source?:ImportSource}>());
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;stopRequested.current=true;handle.current?.cancel();};},[]);
 const runImport=async(next:ImportHandle,quiet=false,suffix=""):Promise<ImportProgress>=>{
  if(stopRequested.current)next.cancel();handle.current=next;setImpPaused(false);const unsubscribe=next.subscribe(setImp);
  try{const result=await next.promise;if(alive.current){await refresh();if(!quiet)notify(`${result.cancelled?"导入已停止":"导入完成"}：新增 ${result.imported} · 更新 ${result.updated} · 重复 ${result.duplicated}${result.failed.length?` · 失败 ${result.failed.length}`:""}${suffix}`);}return result;}
  finally{unsubscribe();if(handle.current===next)handle.current=null;}
 };
 const guard=(work:()=>Promise<void>)=>{
  if(preparingRef.current||handle.current||sharedBusy.current)return;stopRequested.current=false;preparingRef.current=true;setPreparing(true);manager?.setImporting(true);
  void work().catch(reason=>{if(alive.current){reportError(reason);setFileStatus(previous=>({...previous,phase:"failed",error:String(reason)}));}}).finally(()=>{preparingRef.current=false;if(alive.current){setPreparing(false);manager?.setImporting(false);}});
 };
 const importPixcall=(scan:PixcallScan|PixcallEntry[])=>guard(async()=>{await runImport(importSources(await preparePixcallImport(scan)));});
 const startImport=()=>guard(async()=>{
  if(isDesktop()){const selected=await open({multiple:true,directory:false,title:"选择要导入的文件"});if(!selected)return;const paths=typeof selected==="string"?[selected]:selected;await runImport(importSources(paths.map(path=>({path,name:path.replaceAll("\\","/").split("/").at(-1)??"未命名"}))));return;}
  if(import.meta.env.DEV){try{const response=await fetch("/__fixtures/manifest.json");if(response.ok){const entries=await response.json() as {url:string}[];await runImport(importUrls(entries.map(entry=>entry.url)));return;}}catch{/* 没有 fixtures 时走文件选择器。 */}}
  const input=document.createElement("input");input.type="file";input.multiple=true;input.onchange=()=>{if(input.files)void runImport(importFiles([...input.files])).catch(reportError);};input.click();
 });
 const importPaths=(paths:string[],target:AcquisitionTarget)=>guard(async()=>{
  if(target.error)throw new Error(target.error);
  const plan=await prepareAcquisition(repository.root,repository.session,paths,target);
  for(const folder of plan.folders){if(stopRequested.current)return;await ensureCollections(repository.root,folder,repository.session);}
  if(stopRequested.current)return;
  const sources=plan.sources.map(source=>({name:source.name,path:source.path,relativePath:source.relative_path??undefined}));
  const result=await runImport(importSources(sources),false,`${plan.folders.length?` · 保留 ${plan.folders.length} 个目录`:""}${plan.warnings.length?` · 未导入 ${plan.warnings.length} 项（查看文件问题）`:""}`);
  if(alive.current){
   for(const warning of plan.warnings){const key=`acquisition:${warning.path}`;acquisitionIssues.current.set(key,{issue:{key,path:warning.path,message:warning.message,kind:"import"}});}
   for(const failure of result.failed){const source=sources.find(source=>(source.relativePath??source.name)===failure.name),key=`acquisition:${source?.path??failure.name}`;acquisitionIssues.current.set(key,{issue:{key,path:source?.path??failure.name,message:failure.reason,kind:"import",retryable:!!source},source});}
   setFileStatus(previous=>({...previous,issues:[...previous.issues.filter(issue=>issue.kind!=="import"),...[...acquisitionIssues.current.values()].map(value=>value.issue)]}));
   window.dispatchEvent(new Event("ceas-folders-changed"));
  }
 });
 const retryAcquisition=(key:string)=>guard(async()=>{const entry=acquisitionIssues.current.get(key);if(!entry?.source)return;const result=await runImport(importSources([entry.source]));if(!result.failed.length&&!result.cancelled)acquisitionIssues.current.delete(key);else entry.issue.message=result.failed[0]?.reason??"导入已停止";setFileStatus(previous=>({...previous,issues:[...previous.issues.filter(issue=>issue.kind!=="import"),...[...acquisitionIssues.current.values()].map(value=>value.issue)]}));});
 const dropFiles=(files:File[],target?:AcquisitionTarget)=>guard(async()=>{if(target?.error)throw new Error(target.error);await runImport(importFiles(files,target?.path));});
 const checkDisk=(force=false)=>guard(async()=>{
  if(!isDesktop())return;setFileStatus(previous=>({...previous,phase:"checking",error:undefined}));
  const result=await coordinateFiles(repository,force,()=>stopRequested.current||!alive.current,(sources,options)=>runImport(importSources(sources,options),true),()=>setFileStatus(previous=>({...previous,phase:"processing"})));
  if(!alive.current)return;if(result.changed)await refresh();setFileStatus(previous=>({...previous,...result,issues:[...result.issues,...[...acquisitionIssues.current.values()].map(value=>value.issue)],phase:"idle",checkedAt:Date.now(),error:undefined}));
 });
 const checkRef=useRef(checkDisk);checkRef.current=checkDisk;
 useEffect(()=>{
  if(!isDesktop())return;let disposed=false,polling=false,last=0;
  const poll=async(force=false)=>{if(disposed||polling||preparingRef.current||handle.current||sharedBusy.current||suspended.current)return;polling=true;
   try{const status=await watchLibrary(repository.root,repository.session);if(disposed)return;setFileStatus(previous=>({...previous,mode:status.mode,...(status.error?{error:status.error}:{})}));if(force||status.changed||Date.now()-last>30000){last=Date.now();checkRef.current();}}
   catch(reason){if(!disposed)setFileStatus(previous=>({...previous,phase:"failed",error:String(reason)}));}finally{polling=false;}
  };
  const timer=window.setInterval(()=>void poll(),2000),first=window.setTimeout(()=>void poll(true),1000),focus=()=>void poll(true);window.addEventListener("focus",focus);
  return()=>{disposed=true;window.clearInterval(timer);window.clearTimeout(first);window.removeEventListener("focus",focus);};
 },[repository]);
 const afterAction=async()=>{await refresh();if(alive.current)window.setTimeout(()=>{if(alive.current)checkRef.current(true);},0);};
 const associate=(id:string)=>guard(async()=>{const path=await open({directory:false,multiple:false,defaultPath:repository.root,title:"选择资料库内的原件"});if(typeof path!=="string")return;await associateFile(repository,id,path);await afterAction();});
 const resolveAmbiguity=(id:string,path:string)=>guard(async()=>{await associateFile(repository,id,path);await afterAction();});
 const keepIndependent=(relativePath:string)=>guard(async()=>{const fingerprint=await fingerprintLibraryFile(repository.root,relativePath,repository.session);await runImport(importSources([{name:relativePath.split("/").at(-1)??relativePath,path:`${repository.root}/${relativePath}`,relativePath,expectedHash:fingerprint.hash}],{diskPaths:[relativePath]}));await afterAction();});
 const retryTasks=()=>guard(async()=>{const tasks=await fileTasks(repository,true);setFileStatus(previous=>({...previous,tasks}));await afterAction();});
 const cancelTask=(key:string)=>guard(async()=>{await callStore(repository.root,{action:"cancel_file_task",key},repository.session);await afterAction();});
 const retargetTask=(key:string,target:string)=>guard(async()=>{await ensureParent(repository.root,target,repository.session);await callStore(repository.root,{action:"retarget_file_task",key,target},repository.session);await afterAction();});
 /* 内容解不开：接受当前字节，按普通文件保留。 */
 const acceptContent=(id:string)=>guard(async()=>{await acceptFileContent(repository,id);notify("已按普通文件保留当前内容");await afterAction();});
 /* 收藏集目录被搬到库外：选自它现在所在的文件夹，收回库内原位置后再核对一次。 */
 const relocateCollection=(id:string,label:string)=>guard(async()=>{
  const picked=await open({directory:true,multiple:false,title:`选择「${label||"这个收藏集"}」现在所在的文件夹`});
  if(typeof picked!=="string")return;
  const restored=await relocateCollectionFolder(repository,id,picked);
  notify(restored.mode==="moved"?`已收回 ${restored.files} 个文件`:`已复制 ${restored.files} 个文件，原目录仍保留`);
  await afterAction();
 });
 const importing=!!imp?.running||preparing;
 useEffect(()=>{manager?.setImporting(importing);return()=>manager?.setImporting(false);},[importing,manager?.setImporting]);
 useEffect(()=>{manager?.setImportStop(()=>{stopRequested.current=true;handle.current?.cancel();});return()=>manager?.setImportStop(null);},[manager?.setImportStop]);
 useEffect(()=>{
  if(!manager?.pending)return;const scan=manager.pending.scan;
  // 延到挂载提交之后，避免开发态 StrictMode 清理把跨库导入队列误当离开页面取消。
  const timer=window.setTimeout(()=>{manager.consumeImport();importPixcall(scan);},0);
  return()=>window.clearTimeout(timer);
 },[manager?.pending]);
 useEffect(()=>{if(manager?.scanRequested){manager.consumeScan();checkDisk(true);}},[manager?.scanRequested]);
 return {imp,setImp,impPaused,setImpPaused,handle,importPixcall,startImport,dropFiles,importPaths,retryAcquisition,refreshDisk:()=>checkDisk(true),importing,fileStatus,associate,resolveAmbiguity,keepIndependent,retryTasks,cancelTask,retargetTask,acceptContent,relocateCollection};
}
