import { useCallback,useEffect,useRef,useState } from "react";
import { bindLibraryRoot,callStore,isDesktop } from "./desktop";
import { hydrateLibraryState,flushLibraryState } from "./library-state";
import { flushRepositoryWrites } from "./db";
import { libraryRequest,type LibrarySnapshot,type TransferProgress,type ManagerPage,type PendingImport,type LibraryRecord } from "./library-manager";
const EMPTY:LibrarySnapshot={libraries:[],active:null,guide:{step:0,done:false}};
export function useLibraryController(){
 const [snapshot,setSnapshot]=useState(EMPTY),[loaded,setLoaded]=useState(false),[opened,setOpened]=useState(false),[page,setPage]=useState<ManagerPage>("home");
 const [busy,setBusy]=useState(""),[error,setError]=useState(""),[importing,setImporting]=useState(false),[task,setTask]=useState<TransferProgress|null>(null),[pending,setPending]=useState<PendingImport|null>(null);
 const operating=useRef(false),generation=useRef(0),boundSession=useRef("");
 const [scanRequested,setScanRequested]=useState(false);
 const stopImport=useRef<(()=>void)|null>(null),[queued,setQueued]=useState<LibraryRecord|null>(null);
 const refresh=useCallback(async()=>{
  const version=++generation.current;const next=await libraryRequest<LibrarySnapshot>({action:"list"});
  if(version!==generation.current)return;
  if(next.active?.session!==boundSession.current){
   bindLibraryRoot(next.active?.path??"",next.active?.session??"");
   const state=next.active?await callStore<Record<string,string>>(next.active.path,{action:"state"},next.active.session):{};
   if(version!==generation.current)return;hydrateLibraryState(state);boundSession.current=next.active?.session??"";
  }
  setSnapshot(next);setLoaded(true);
 },[]);
 useEffect(()=>{if(!isDesktop()){setLoaded(true);return;}void refresh().catch((reason:unknown)=>{setError(String(reason));setLoaded(true);setOpened(true);});},[refresh]);
 useEffect(()=>{if(!isDesktop()||!loaded||busy)return;const timer=window.setInterval(()=>{void refresh().catch(()=>{});},5000);return()=>window.clearInterval(timer);},[refresh,loaded,busy]);
 const perform=async(label:string,work:()=>Promise<unknown>)=>{
  if(operating.current)return false;
  if(importing){setError("当前正在处理导入或文件核对。请完成或停止当前任务后再管理资料库。");return false;}
  operating.current=true;setBusy(label);setError("");
  try{await flushRepositoryWrites();await flushLibraryState();await work();await refresh();return true;}
  catch(reason){setError(String(reason));await refresh().catch(()=>{});return false;}
  finally{operating.current=false;setBusy("");}
 };
 useEffect(()=>{
  if(!busy)return;
  const timer=window.setInterval(()=>{void libraryRequest<TransferProgress|null>({action:"task"}).then(setTask).catch(()=>{});},300);
  return()=>window.clearInterval(timer);
 },[busy]);
 useEffect(()=>{if(isDesktop()&&loaded)void libraryRequest<TransferProgress|null>({action:"task"}).then(setTask).catch(()=>{});},[loaded,busy]);
 const open=useCallback((next:ManagerPage="home")=>{setPage(next);setOpened(true);setError("");},[]);
 const close=()=>{if(busy)return;setOpened(false);setError("");};
 useEffect(()=>{if(!importing&&!busy&&queued){setQueued(null);void perform(`正在打开 ${queued.name}…`,()=>libraryRequest({action:"open",path:queued.path})).then(success=>{if(success)setOpened(false);});}},[importing,busy,queued]);
 const finishGuide=async()=>{try{await libraryRequest({action:"guide",step:2,done:true});await refresh();setPage("home");setOpened(false);}catch(reason){setError(String(reason));}};
 return {snapshot,loaded,opened,page,setPage,open,close,busy,error,setError,importing,setImporting,task,pending,setPending,refresh,perform,finishGuide,
  consumeImport:useCallback(()=>setPending(null),[]),scanRequested,setScanRequested,consumeScan:useCallback(()=>setScanRequested(false),[]),queued,
  queueOpen:(record:LibraryRecord,stop=false)=>{setQueued(record);if(stop)stopImport.current?.();},cancelQueued:()=>setQueued(null),
  setImportStop:useCallback((stop:(()=>void)|null)=>{stopImport.current=stop;},[])};
}
export type LibraryController=ReturnType<typeof useLibraryController>;
