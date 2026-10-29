import { useEffect,useRef,useState } from "react";
import { callStore,getLibraryRoot,isDesktop,exportLibraryCatalog,revealInExplorer,type PixcallScan } from "@/data/desktop";
import { useLibraryContext } from "@/data/library-context";
import { flushLibraryState } from "@/data/library-state";
import { flushRepositoryWrites } from "@/data/db";
type Props={onClose:()=>void;onImportPixcall?:(scan:PixcallScan)=>void;importing?:boolean;onRefreshDisk?:()=>void;onLibraryUpdated?:()=>Promise<void>;
 /* 检查是自动的，设置里只是兜底入口；所以要一并显示「上次检查」的结果，而不是只给一个按钮。 */
 fileStatus?:{phase:string;checkedAt?:number;issues:number;mode:string}};
export function Settings({onClose,importing=false,onRefreshDisk,fileStatus}:Props){
 const context=useLibraryContext();const [tab,setTab]=useState<"general"|"about">("general");const [stats,setStats]=useState<{visible:number;tags:number}|null>(null),[error,setError]=useState(""),[note,setNote]=useState(""),[busy,setBusy]=useState(false);const dialog=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement;dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();return()=>{if(previous instanceof HTMLElement)previous.focus();};},[]);
 useEffect(()=>{if(isDesktop())void callStore<{visible:number;tags:number}>(getLibraryRoot(),{action:"stats"}).then(setStats).catch(reason=>setError(String(reason)));},[]);
 return <div className="settings-mask" onPointerDown={()=>{if(!busy)onClose();}}>
  <div className="settings" ref={dialog} role="dialog" aria-modal="true" aria-label="设置" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{
   if(e.key==="Escape"){e.preventDefault();e.stopPropagation();if(!busy)onClose();}
   if(e.key==="Tab"){const fields=[...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];const first=fields[0],last=fields.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  }}>
   <nav className="settings-nav"><button data-active={tab==="general"||undefined} onClick={()=>setTab("general")}>通用</button><button data-active={tab==="about"||undefined} onClick={()=>setTab("about")}>关于</button></nav>
   <section className="settings-body"><header className="settings-head"><h2>{tab==="general"?"通用":"关于"}</h2><button className="settings-close" disabled={busy} onClick={onClose} aria-label="关闭"><kbd>Esc</kbd></button></header>
    {tab==="general"?<>
     <div className="settings-section-title">资料库</div><div className="settings-row"><div className="settings-row-main"><div className="settings-label">{context?.active?.name??"浏览器开发模式"}</div><div className="settings-path">{context?.active?.path??"浏览器数据与桌面资料库独立"}</div><p className="settings-hint">{stats?`${stats.visible} 项素材 · ${stats.tags} 个已使用标签`:"原件使用普通文件名和文件夹，整理信息随资料库保存。"}</p></div></div>
     <div className="settings-actions"><button className="settings-btn" disabled={!context||busy} onClick={()=>{onClose();context?.open();}}>管理资料库</button><button className="settings-btn" disabled={!context||busy} onClick={()=>{onClose();context?.open("guide");}}>新手引导</button><button className="settings-btn" disabled={!context||busy} onClick={()=>void revealInExplorer(context?.active?.path??"").catch(reason=>setError(String(reason)))}>在资源管理器中显示</button></div>
     <div className="settings-section-title">文件与索引</div><div className="settings-actions"><button className="settings-btn" disabled={!context||busy||importing} onClick={()=>{onRefreshDisk?.();onClose();}}>检查文件变化</button><button className="settings-btn" disabled={!context||busy||importing} onClick={()=>{setBusy(true);setError("");void(async()=>{await flushRepositoryWrites();await flushLibraryState();setNote(`可读元数据已导出：${await exportLibraryCatalog(getLibraryRoot())}`);})().catch(reason=>setError(String(reason))).finally(()=>setBusy(false));}}>导出可读元数据</button><button className="settings-btn" disabled={!context||busy||importing} onClick={()=>{onClose();context?.open("import");}}>从 Pixcall 导入</button></div><p className="settings-hint">{fileStatus?.checkedAt?`上次检查：${new Date(fileStatus.checkedAt).toLocaleString()} · ${fileStatus.issues?`发现 ${fileStatus.issues} 项待处理`:"未发现问题"}`:"本次启动尚未检查（打开软件、切回窗口、文件变化都会自动检查）"}。{fileStatus?.mode==="polling"?"系统通知不可用，已改为每 30 秒检查。":""}</p><p className="settings-hint">电脑文件夹中的变化会自动同步；导出清单是可读信息副本。</p>
    </>:<><div className="settings-section-title">Ceas</div><div className="settings-row"><div className="settings-row-main"><div className="settings-label">0.1.0 · 工程验证版</div><p className="settings-value">Tauri · React · 普通文件夹资料库</p></div></div></>}
    {error?<p className="settings-error" role="alert">{error}</p>:null}{note?<p className="settings-hint" role="status">{note}</p>:null}
   </section>
  </div>
 </div>;
}
