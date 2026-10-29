import { useRef,useState } from "react";
import type { FileStatus } from "@/data/file-coordinator";
import { trapPanelKeys,useFilePanelFocus } from "./FileStatus";
import "./library-organization.css";
import {isDesktop,revealInExplorer} from "@/data/desktop";
type Props={status:FileStatus;busy:boolean;onClose:()=>void;onCheck:()=>void;onAssociate:(id:string)=>void;onResolve:(id:string,path:string)=>void;onKeep:(path:string)=>void;onRetryTasks:()=>void;onCancelTask:(key:string)=>void;onRetargetTask:(key:string,target:string)=>void;onAdoptMissing:(ids:string[])=>void;onAcceptContent:(id:string)=>void;onRelocate:(id:string,label:string)=>void;onIgnore?:(id:string)=>void};
export function FileIssues({status,busy,onClose,onCheck,onAssociate,onResolve,onKeep,onRetryTasks,onCancelTask,onRetargetTask,onAdoptMissing,onAcceptContent,onRelocate,onIgnore,onRetryImport}:Props&{onRetryImport?:(key:string)=>void}){
 const dialog=useRef<HTMLDivElement>(null);useFilePanelFocus(dialog);
 const [targets,setTargets]=useState<Record<string,string>>({}),[visible,setVisible]=useState(100),[actionError,setActionError]=useState("");
 return <div className="organization-mask" onPointerDown={onClose}><div ref={dialog} className="organization-dialog file-issues-dialog" role="dialog" aria-modal="true" aria-label="文件问题" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>trapPanelKeys(e,onClose)}>
  <div className="organization-existing"><strong>文件问题</strong><button className="query-action" onClick={onClose}>关闭</button><button className="query-action" disabled={busy} onClick={onCheck}>重新检查</button></div>
  <p className="query-help">{status.mode==="native"?"文件通知发现变化后合并核对，另有周期核对兜底。":"当前使用周期核对，也可以手动重试。"}在资源管理器里删掉的文件会进回收站并保留整理信息；不可读的文件只标状态，不会被当成删除。整个收藏集被搬出资料库时，可以选它现在所在的文件夹收回原位置。</p>
  <p className="query-help">最后核对：{status.checkedAt?new Date(status.checkedAt).toLocaleString():"尚未完成"} · 忽略系统辅助项 {status.ignored??0}</p>
  {status.error?<p className="query-error" role="alert">{status.error}</p>:null}
  {actionError?<p className="query-error" role="alert">{actionError}</p>:null}
  {!status.issues.length&&!status.tasks.length?<p role="status">目前没有待处理项。</p>:null}
  {status.issues.slice(0,visible).map(issue=><section key={issue.key} className="file-issue"><strong>{issue.path}</strong><p className="query-help">{issue.message}</p><div className="organization-existing">
   {issue.kind==="import"&&issue.retryable&&onRetryImport?<button className="query-action" disabled={busy} onClick={()=>onRetryImport(issue.key)}>重试导入此文件</button>:null}
   {issue.kind==="import"&&isDesktop()?<button className="query-action" disabled={busy} onClick={()=>{setActionError("");void revealInExplorer(issue.path.replaceAll("\\","/").split("/").slice(0,-1).join("/")).catch(reason=>setActionError(String(reason)));}}>打开来源文件夹</button>:null}
   {issue.id&&(issue.kind==="missing"||issue.kind==="unreadable")?<button className="query-action" disabled={busy} onClick={()=>onAssociate(issue.id??"")}>选择库内文件关联</button>:null}
   {issue.candidates?.map((id,index)=><button key={id} className="query-action" disabled={busy} onClick={()=>onResolve(id,issue.path)}>关联给：{issue.candidateLabels?.[index]??id}</button>)}
   {issue.kind==="ambiguous"?<button className="query-action" disabled={busy} onClick={()=>onKeep(issue.path)}>保留为独立素材</button>:null}
   {issue.kind==="missing-mass"?<><button className="query-action" disabled={busy} onClick={()=>onAdoptMissing(issue.ids??[])}>移入回收站</button>{issue.collectionId?<button className="query-action" disabled={busy} onClick={()=>onRelocate(issue.collectionId??"",issue.path)}>重新定位…</button>:null}</>:null}
   {issue.kind==="decode"&&issue.id?<button className="query-action" disabled={busy} onClick={()=>onAcceptContent(issue.id??"")}>按普通文件保留</button>:null}
   {(issue.kind==="pending"||issue.kind==="unreadable"||issue.kind==="decode")&&issue.id&&onIgnore?<button className="query-action" disabled={busy} onClick={()=>onIgnore(issue.id??"")}>忽略此文件</button>:null}
  </div></section>)}
  {visible<status.issues.length?<button className="query-action" onClick={()=>setVisible(value=>value+100)}>再显示 100 项（共 {status.issues.length} 项）</button>:null}
  {status.tasks.map(task=><section key={task.key} className="file-issue"><strong>待恢复的文件操作</strong><p className="file-issue-path">任务：{task.key}</p><p className="file-issue-path">源：{task.source} → 目标：{task.target}</p><p className="query-error">{task.message}</p><div className="organization-existing"><button className="query-action" disabled={busy} onClick={onRetryTasks}>重试恢复操作</button>{task.cancellable?<button className="query-action" disabled={busy} onClick={()=>onCancelTask(task.key)}>取消尚未移动的操作</button>:null}</div>{task.retargetable?<><label className="query-field"><span>新的恢复相对路径</span><input value={targets[task.key]??task.target} disabled={busy} onChange={e=>setTargets(previous=>({...previous,[task.key]:e.target.value}))}/></label><button className="query-action" disabled={busy||!(targets[task.key]??task.target)} onClick={()=>onRetargetTask(task.key,targets[task.key]??task.target)}>使用新地址恢复</button></>:null}</section>)}
 </div></div>;
}
