import {useEffect,useRef,useState,type DragEvent} from "react";
import {resolveAcquisitionTarget,type AcquisitionCollection,type AcquisitionTarget} from "@ceas/core/acquisition";
import {clipboardFilePaths,getLibraryRoot,getLibrarySession,isDesktop,onNativeDrop} from "./desktop";

type Options={place:string;filtered:boolean;collections:readonly AcquisitionCollection[];busy:boolean;blocked:boolean;notify:(message:string)=>void;importPaths:(paths:string[],target:AcquisitionTarget)=>void;importFiles:(files:File[],target:AcquisitionTarget)=>void};
const editing=(target:EventTarget|null)=>target instanceof HTMLElement&&(target.isContentEditable||!!target.closest('input,textarea,select,[role="textbox"]'));

/** 原生坐标为物理像素；命中检测使用 CSS 像素，跨密度与系统缩放保持一致。 */
export function useAcquisition(options:Options){
 const current=useRef(options);current.current=options;
 const [feedback,setFeedback]=useState<AcquisitionTarget|null>(null),[hoverId,setHoverId]=useState<string|undefined>();
 const resolve=(x?:number,y?:number)=>{
  const state=current.current;
  const row=x===undefined||y===undefined?null:document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-acquisition-folder]');
  const hover=row?.dataset.acquisitionFolder;
  const target=resolveAcquisitionTarget(state.place,state.filtered,state.collections,hover);
  if(state.blocked)target.error="请先关闭当前面板，再导入文件";
  else if(state.busy)target.error="正在处理文件，请完成或停止后再导入";
  return {target,hover};
 };
 const accept=(target:AcquisitionTarget,work:()=>void)=>{if(target.error)current.current.notify(target.error);else work();};
 useEffect(()=>{
  if(!isDesktop())return;
  let alive=true,off:(()=>void)|undefined;
  void onNativeDrop(event=>{
   if(!alive)return;
   if(event.type==="leave"){setFeedback(null);setHoverId(undefined);return;}
   const {target,hover}=resolve(event.position.x/window.devicePixelRatio,event.position.y/window.devicePixelRatio);
   if(event.type==="drop"){
    setFeedback(null);setHoverId(undefined);
    accept(target,()=>current.current.importPaths(event.paths,target));
   }else{setFeedback(target);setHoverId(hover);}
  }).then(unlisten=>{if(alive)off=unlisten;else unlisten();}).catch(()=>{if(alive)current.current.notify("系统拖放未能启用，请重新打开客户端；仍可选择文件或粘贴导入");});
  return()=>{alive=false;off?.();};
 },[]);
 useEffect(()=>{
  let alive=true,pasting=false;
  const paste=async(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.repeat||event.isComposing||event.shiftKey||event.altKey||!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=="v"||editing(event.target)||current.current.blocked||!isDesktop())return;
   event.preventDefault();if(pasting)return;
   const {target}=resolve();if(target.error){current.current.notify(target.error);return;}
   pasting=true;const root=getLibraryRoot(),session=getLibrarySession();
   try{const paths=await clipboardFilePaths(root,session);if(!alive||root!==getLibraryRoot()||session!==getLibrarySession())return;if(paths.length)current.current.importPaths(paths,target);else current.current.notify("剪贴板中没有文件，请先在资源管理器中复制文件或文件夹");}
   catch(reason){if(alive)current.current.notify(String(reason));}finally{pasting=false;}
  };
  window.addEventListener("keydown",paste);
  return()=>{alive=false;window.removeEventListener("keydown",paste);};
 },[]);
 const onDragOver=(event:DragEvent<HTMLDivElement>)=>{
  event.preventDefault();if(isDesktop())return;
  const {target,hover}=resolve(event.clientX,event.clientY);event.dataTransfer.dropEffect=target.error?"none":"copy";setFeedback(target);setHoverId(hover);
 };
 const onDrop=(event:DragEvent<HTMLDivElement>)=>{
  event.preventDefault();setFeedback(null);setHoverId(undefined);if(isDesktop())return;
  const {target}=resolve(event.clientX,event.clientY);
  if([...event.dataTransfer.items].some(item=>item.webkitGetAsEntry?.()?.isDirectory)){current.current.notify("浏览器预览暂不支持文件夹拖入，请使用桌面版");return;}
  accept(target,()=>current.current.importFiles([...event.dataTransfer.files],target));
 };
 return {feedback,hoverId,onDragOver,onDrop,onDragLeave:(event:DragEvent<HTMLDivElement>)=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget)){setFeedback(null);setHoverId(undefined);}}};
}
