import { libraryRequest,type TransferProgress } from "@/data/library-manager";
const PHASES:Record<string,string>={preparing:"正在准备",copying:"正在复制原件",verifying:"正在校验",renaming:"正在修改目录名称",activating:"正在启用新位置",completed:"已完成",failed:"操作未完成",interrupted:"上次操作被中断"};
export function LibraryTask({task,onRetry}:{task:TransferProgress;onRetry:()=>void}){
 return <section className="library-card" aria-label="资料库任务">
  <div className="library-item-head"><strong>{task.kind==="rename"?"目录改名":"迁移资料库"}</strong><span className="library-badge" role="status">{PHASES[task.phase]??task.phase}</span></div>
  <p className="library-path">原位置：{task.source}</p><p className="library-path">目标：{task.target}</p>
  {task.running?<><progress aria-label="迁移进度" className="library-progress" max={task.total||1} value={task.bytes}/><p className="library-small">{task.completed} / {task.files} 个文件 · {Math.round(task.bytes/1024)} / {Math.round(task.total/1024)} KB</p>
   {task.phase==="copying"?<button className="library-btn" onClick={()=>void libraryRequest({action:"cancel_task"})}>停止迁移</button>:<p className="library-small">正在处理提交边界，请等待此阶段结束。</p>}</>:null}
  {task.error?<><p className="library-error">{task.error}</p><p className="library-path">暂存副本：{task.staging}</p><button className="library-btn" onClick={onRetry}>重新选择位置并重试</button></>:task.phase==="completed"?<p className="library-muted">新位置已启用。{task.kind==="move"?"原位置的副本仍保留，可自行查看后处理。":""}</p>:null}
 </section>;
}
