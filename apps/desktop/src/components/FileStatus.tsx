import { useEffect,useRef,useState } from "react";
import type { FileStatus as Status } from "@/data/file-coordinator";
import "./file-status.css";

/* ══ 检查文件变化：常态零存在 ══════════════════════════════════
   这是基础设施，不是功能（09「检查文件变化」）。所以：
   · 一切正常 → **什么都不渲染**，不占位
   · 有问题   → 一行「N 个文件和库不一致」+ 查看
   · 单次检查超过 10 秒 → 一行「正在检查文件变化…」（否则大库没反馈像卡死）
   · 检查本身失败 → 一行「检查未完成 + 重试」

   一行永远显示"没事"的状态栏，第一次真出问题时反而不容易被注意到。
   ------------------------------------------------------------ */

export function FileStatus({status,onOpen,onCheck,busy}:{status:Status;onOpen:()=>void;onCheck:()=>void;busy:boolean}){
 const count=status.issues.length+status.tasks.length;
 const [slow,setSlow]=useState(false);

 /* 10 秒阈值（01 §6.5）：短检查不该闪一下提示。 */
 useEffect(()=>{
  if(status.phase!=="checking"&&status.phase!=="processing"){setSlow(false);return;}
  const timer=window.setTimeout(()=>setSlow(true),10000);
  return ()=>window.clearTimeout(timer);
 },[status.phase]);

 if(status.phase==="failed"&&status.error){
  return <div className="query-summary"><span role="status" aria-live="polite">检查未完成：{status.error}</span><button type="button" data-file-check className="query-action" disabled={busy} onClick={onCheck}>重试</button></div>;
 }
 if(count>0){
  return <div className="query-summary"><span role="status" aria-live="polite">{count} 个文件和库不一致</span><button type="button" data-file-check className="query-action" onClick={onOpen}>查看</button></div>;
 }
 if(slow){
  return <div className="query-summary"><span role="status" aria-live="polite">正在检查文件变化…</span></div>;
 }
 return null;
}

export function useFilePanelFocus(ref:React.RefObject<HTMLDivElement|null>){
 const previous=useRef(document.activeElement),returnFrame=useRef<number|undefined>(undefined);
 useEffect(()=>{
  if(returnFrame.current!==undefined)window.cancelAnimationFrame(returnFrame.current);
  ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  return()=>{returnFrame.current=window.requestAnimationFrame(()=>{const target=previous.current;if(target instanceof HTMLElement&&target.isConnected)target.focus();else document.querySelector<HTMLButtonElement>("button[data-file-check]")?.focus();});};
 },[ref]);
}
export function trapPanelKeys(event:React.KeyboardEvent<HTMLDivElement>,close:()=>void){
 if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();}
 if(event.key==="Tab"){const fields=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];const first=fields[0],last=fields.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
}
