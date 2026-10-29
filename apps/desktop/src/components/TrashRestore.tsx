import { useEffect,useRef,useState } from "react";
import { callStore } from "@/data/desktop";
import { trapPanelKeys,useFilePanelFocus } from "./FileStatus";
import "./library-organization.css";

/* ══ 恢复回收项 ══════════════════════════════════════════════
   回收站里有两类来源，能力不同，不能挂在同一个按钮后面：
   · 应用回收：原件在 `.ceas/trash`，可完整还原（本文件原有流程）
   · 磁盘删除：原件已不在盘上，**没有字节可还原**，只能重新指认或清掉记录

   把两类混成一个"恢复"，等于承诺一个做不到的结果（09「两种来源」）。
   ------------------------------------------------------------ */

type Preview={id:string;original:string;target:string;conflict:boolean;available:boolean};
type Props={
  ids:string[];root:string;session:string;onClose:()=>void;onRestore:(folder?:string)=>Promise<void>;
  /** 其中「磁盘删除」的 id：没有原件，只能清记录 */
  diskIds?:string[];
  /** 清掉这些没有原件的记录（彻底删除） */
  onPurge?:(ids:string[])=>Promise<void>;
  /** 把整理信息合并到库里另一份素材（原件已不在，内容无法还原） */
  onMerge?:(ids:string[])=>Promise<void>;
};
export function TrashRestore({ids,root,session,onClose,onRestore,diskIds=[],onPurge,onMerge}:Props){
 const disk=new Set(diskIds),restorable=ids.filter(id=>!disk.has(id));
 const [folder,setFolder]=useState(""),[rows,setRows]=useState<Preview[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const dialog=useRef<HTMLDivElement>(null);useFilePanelFocus(dialog);
 /* 没有可还原项时不必再问后端：直接说明事实，避免一个注定的失败。 */
 const preview=async()=>{if(restorable.length===0)return;setBusy(true);setError("");try{setRows(await callStore<Preview[]>(root,{action:"restore_preview",ids:restorable,folder},session));}catch(reason){setError(String(reason));}finally{setBusy(false);}};
 useEffect(()=>{void preview();},[]);

 if(restorable.length===0) return <div className="organization-mask" onPointerDown={()=>{if(!busy)onClose();}}><div ref={dialog} className="organization-dialog" role="dialog" aria-modal="true" aria-label="没有可还原的原件" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>trapPanelKeys(e,()=>{if(!busy)onClose();})}>
  <strong>{ids.length} 项没有可还原的原件</strong>
  <p className="query-help">这些文件是在资源管理器里删除的，磁盘上已经不存在，回收区里也没有副本，所以无法还原字节。标签、描述和位置记录仍然保留。三种出路：把文件放回原处会自动复活；把整理信息合并到库里另一版；或者直接清掉记录。</p>
  {error?<p className="query-error" role="alert">{error}</p>:null}
  <div className="organization-existing">
   {onMerge&&ids.length===1?<button className="query-action" disabled={busy} onClick={()=>{setBusy(true);setError("");void onMerge(ids).then(onClose,(reason:unknown)=>setError(String(reason))).finally(()=>setBusy(false));}}>把整理信息合并到…</button>:null}
   {onPurge?<button className="query-action" disabled={busy} onClick={()=>{setBusy(true);setError("");void onPurge(ids).then(onClose,(reason:unknown)=>setError(String(reason))).finally(()=>setBusy(false));}}>彻底删除记录</button>:null}
   <button className="query-action" disabled={busy} onClick={onClose}>取消</button>
  </div>
 </div></div>;

 return <div className="organization-mask" onPointerDown={()=>{if(!busy)onClose();}}><div ref={dialog} className="organization-dialog file-issues-dialog" role="dialog" aria-modal="true" aria-label="恢复原件" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>trapPanelKeys(e,()=>{if(!busy)onClose();})}>
  <strong>恢复原件 · {restorable.length} 项</strong><p className="query-help">原位置被占用时自动改名，保留双方。确认前不移动任何文件。</p>
  {diskIds.length?<p className="query-help">另有 {diskIds.length} 项是在资源管理器里删除的，没有原件可还原，本次不会处理。</p>:null}
  <label className="query-field"><span>恢复到收藏集（留空使用原位置）</span><input value={folder} disabled={busy} onChange={e=>{setFolder(e.target.value);setRows([]);}} placeholder="例如：参考/已恢复"/></label>
  <button className="query-action" disabled={busy} onClick={()=>void preview()}>预览恢复位置</button>
  {rows.map(row=><section className="file-issue" key={row.id}><p>原位置：{row.original}</p><p>恢复到：{row.target}</p><p className="query-help">{!row.available?"回收原件暂不可用，请检查回收区":row.conflict?"原地址已占用，将保留双方":"原地址可用"}</p></section>)}
  {error?<p className="query-error" role="alert">{error}</p>:null}
  <div className="organization-existing"><button className="query-action" disabled={busy||rows.length===0||rows.some(row=>!row.available)} onClick={()=>{setBusy(true);setError("");void onRestore(folder||undefined).then(onClose,(reason:unknown)=>setError(String(reason))).finally(()=>setBusy(false));}}>恢复，保留双方</button><button className="query-action" disabled={busy} onClick={onClose}>取消</button></div>
 </div></div>;
}
