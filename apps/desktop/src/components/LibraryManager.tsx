import { useEffect,useRef,useState } from "react";
import { Mascot } from "@ceas/ui";
import { Folder,Plus,ChevronRight } from "@ceas/ui/icons";
import { pixcallScan,revealInExplorer,type PixcallScan } from "@/data/desktop";
import { joinFolder,libraryRequest,pickLibraryDirectory,type LibraryRecord,type Probe } from "@/data/library-manager";
import { uuidv7 } from "@/data/uuid";
import type { LibraryController } from "@/data/use-library-controller";
import { LibraryGuide } from "./LibraryGuide";
import { LibraryTask } from "./LibraryTask";
import "./library-manager.css";

export function LibraryManager({controller:c}:{controller:LibraryController}){
 const {snapshot,busy,importing}=c;
 const page=c.page==="home"&&!snapshot.guide.done&&!snapshot.libraries.length?"welcome":c.page;
 const [name,setName]=useState("我的参考库"),[location,setLocation]=useState(""),[adopt,setAdopt]=useState(false),[renameFolder,setRenameFolder]=useState(false);
 const [selected,setSelected]=useState<LibraryRecord|null>(null),[scan,setScan]=useState<PixcallScan|null>(null),[targetId,setTargetId]=useState(""),[notice,setNotice]=useState("");
 const heading=useRef<HTMLHeadingElement>(null);
 const returnFocus=useRef(document.activeElement);
 useEffect(()=>{const container=heading.current?.closest("main");container?.querySelector<HTMLElement>('input:not([readonly]):not(:disabled),button:not(:disabled)')?.focus();},[page]);
 useEffect(()=>()=>{window.requestAnimationFrame(()=>{const previous=returnFocus.current;if(previous instanceof HTMLElement&&previous.isConnected&&previous!==document.body)previous.focus();else document.querySelector<HTMLButtonElement>('button[aria-label="管理资料库"]')?.focus();});},[]);
 const home=()=>{c.setPage("home");c.setError("");setNotice("");};
 const pick=async(title:string)=>{try{return await pickLibraryDirectory(title);}catch(reason){c.setError(String(reason));return null;}};
 const open=async(record?:LibraryRecord)=>{
  const path=record?.path??await pick("选择完整的 Ceas 资料库文件夹");if(!path)return;
  const success=await c.perform("正在验证资料库…",async()=>{
   const probe=await libraryRequest<Probe>({action:"probe",path});
   if(probe.kind!=="library"){
    if(probe.kind==="pixcall"){const found=await pixcallScan(path);if(found)setScan(found);c.setPage("import");return;}
    if(probe.kind==="folder"){setAdopt(true);setLocation(path);setName(path.replaceAll("\\","/").split("/").at(-1)??"我的参考库");c.setPage("create");setNotice("这是普通文件夹。确认后将在原位置建立资料库索引。");return;}
    throw new Error(probe.error??"无法打开此资料库");
   }
   await libraryRequest({action:"open",path});c.close();
  });
  if(success&&record)c.close();
 };
 const create=async()=>{
  if(!location){c.setError("请选择保存位置");return;}
  const path=adopt?location:joinFolder(location,name);
  const success=await c.perform("正在建立资料库…",()=>libraryRequest({action:"create",path,id:uuidv7(),name,existing:adopt}));
  if(success){if(scan){c.setPending({scan});setScan(null);c.close();}else{if(adopt)c.setScanRequested(true);if(!snapshot.guide.done)c.open("guide");else c.close();}}
 };
 const selectFor=(record:LibraryRecord,screen:"rename"|"move")=>{setSelected(record);setName(record.name);setLocation("");setRenameFolder(false);c.setPage(screen);c.setError("");};
 const rename=async()=>{
  if(!selected)return;
  const success=await c.perform("正在保存名称…",()=>libraryRequest({action:"rename",id:selected.id,name,folder_name:renameFolder?name:null,task_id:uuidv7()}));if(success){setNotice("资料库名称已保存");home();}
 };
 const move=async()=>{
  if(!selected||!location)return;
  const basename=selected.path.replaceAll("\\","/").split("/").at(-1)??selected.name;
  const success=await c.perform("正在迁移资料库…",()=>libraryRequest({action:"move",id:selected.id,target:joinFolder(location,basename),task_id:uuidv7()}));if(success)home();
 };
 const importSource=async()=>{const path=await pick("选择 Pixcall 资料库（来源只读）");if(!path)return;await c.perform("正在扫描 Pixcall…",async()=>{const found=await pixcallScan(path);if(found){setScan(found);c.setPage("import");}});};
 const startImport=async()=>{
  if(!scan||!targetId)return;
  const record=snapshot.libraries.find(r=>r.id===targetId);if(!record)return;
  const success=await c.perform("正在打开目标资料库…",()=>libraryRequest({action:"open",path:record.path}));
  if(success){c.setPending({scan});setScan(null);c.close();}
 };
 const selectedActive=selected?.id===snapshot.active?.id;
 return <div className="library-space library-overlay" role="region" aria-label="资料库管理" onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();if(!busy){if(page==="home"||page==="welcome")c.close();else home();}}}}>
 <main className="library-shell">
  <header className="library-heading"><div className="library-back"><span>Ceas</span><span className="library-muted">/ 资料库</span></div><div className="library-actions">
   {page!=="home"&&page!=="welcome"?<button className="library-btn" disabled={!!busy} onClick={home}>返回资料库列表</button>:null}
   {snapshot.active?<button className="library-btn" disabled={!!busy} onClick={c.close}>返回当前资料库</button>:null}
  </div></header>
  {page==="welcome"?<><div className="library-intro"><div className="library-mascot" aria-hidden="true"><Mascot chatter={false}/></div><h1 ref={heading} tabIndex={-1}>给灵感一个位置</h1><p className="library-muted">选择一个普通文件夹，开始收集与整理。文件始终属于你。</p></div>
   <div className="library-options"><button className="library-option" onClick={()=>c.setPage("create")}><Plus/><strong>新建资料库</strong><span className="library-muted">自定义名称和位置，或管理已有素材文件夹。</span></button><button className="library-option" onClick={()=>void open()}><Folder/><strong>打开资料库</strong><span className="library-muted">继续使用一个已有的 Ceas 资料库。</span></button><button className="library-option" onClick={()=>void importSource()}><ChevronRight/><strong>导入资料库</strong><span className="library-muted">从 Pixcall 复制文件、目录与整理信息。</span></button></div>
   <footer className="library-footer"><span className="library-small">一个资料库，一个普通文件夹</span><button className="library-btn" onClick={()=>void c.finishGuide()}>稍后设置</button></footer></>:null}
  {page==="home"?<><div className="library-heading"><div><h1 ref={heading} tabIndex={-1}>你的资料库</h1><p className="library-muted">不同项目，各有自己的位置。</p></div><div className="library-actions"><button className="library-btn" data-primary disabled={!!busy||importing} onClick={()=>{setScan(null);c.setPage("create");}}>新建资料库</button><button className="library-btn" disabled={!!busy||importing} onClick={()=>void open()}>打开资料库</button><button className="library-btn" disabled={!!busy||importing} onClick={()=>void importSource()}>从 Pixcall 导入</button></div></div>
   {!snapshot.libraries.length?<section className="library-card"><h2>尚未打开资料库</h2><p className="library-muted">新建一个资料库，或打开电脑上已有的资料库。你也可以先查看使用引导。</p><button className="library-btn" onClick={()=>c.setPage("guide")}>查看新手引导</button></section>:null}
   <div className="library-list">{snapshot.libraries.map(record=><article className="library-card" data-current={record.id===snapshot.active?.id||undefined} key={record.id}>
    <div className="library-item-head"><Folder/><strong>{record.name}</strong><span className="library-badge">{record.error?"位置不可用":record.id===snapshot.active?.id?"当前使用 · 本地":"本地资料库"}</span></div><p className="library-path">{record.path}</p><p className="library-small">{record.count==null?"数量暂不可用":`${record.count} 项素材`}</p>
    {record.error?<p className="library-muted">{record.error}</p>:null}
    <div className="library-actions"><button className="library-btn" disabled={!!busy||importing||!!record.error} onClick={()=>void open(record)}>打开</button>{importing&&!record.error&&record.id!==snapshot.active?.id?<><button className="library-btn" onClick={()=>c.queueOpen(record)}>完成当前任务后打开</button><button className="library-btn" onClick={()=>c.queueOpen(record,true)}>停止当前任务后打开</button></>:null}<button className="library-btn" disabled={!!busy||importing||!!record.error} onClick={()=>selectFor(record,"rename")}>修改名称</button><button className="library-btn" disabled={!!busy||importing||record.id!==snapshot.active?.id} onClick={()=>selectFor(record,"move")}>迁移位置</button>
     <button className="library-btn" disabled={!!busy||importing} onClick={()=>void(async()=>{const path=await pick("选择移动后的完整资料库文件夹");if(path)await c.perform("正在核验资料库身份…",()=>libraryRequest({action:"relocate",id:record.id,path}));})()}>重新定位</button>
     <button className="library-btn" disabled={!!busy} onClick={()=>void revealInExplorer(record.path).catch(reason=>c.setError(String(reason)))}>在电脑中显示</button>
     <button className="library-btn" disabled={!!busy||importing} onClick={()=>void c.perform("正在移除列表记录…",()=>libraryRequest({action:"forget",id:record.id}))}>从列表移除</button>
    </div>{record.id!==snapshot.active?.id&&!record.error?<p className="library-small">打开此库后可迁移位置。移除列表记录会保留磁盘文件。</p>:<p className="library-small">移除列表记录会保留磁盘文件。</p>}
   </article>)}</div></>:null}
  {page==="create"?<section className="library-card library-form"><h1 ref={heading} tabIndex={-1}>{scan?"新建导入目标库":"新建资料库"}</h1><form className="library-form" onSubmit={e=>{e.preventDefault();void create();}}>
   <label className="library-field">资料库名称<input autoFocus required disabled={!!busy} value={name} onChange={e=>setName(e.target.value)}/></label>
   <label className="library-choice"><input type="checkbox" disabled={!!busy||!!scan} checked={adopt} onChange={e=>{setAdopt(e.target.checked);setLocation("");}}/>使用已有普通文件夹，原地建立索引</label>
   <label className="library-field">{adopt?"现有文件夹":"保存位置"}<input aria-label="保存位置" readOnly value={location} placeholder="请选择非 C 盘位置"/></label><button type="button" className="library-btn" disabled={!!busy} onClick={()=>void pick(adopt?"选择现有普通文件夹":"选择保存位置").then(path=>{if(path)setLocation(path);})}>选择文件夹</button>
   {location?<p className="library-path">最终位置：{adopt?location:joinFolder(location,name)}</p>:null}<p className="library-small">{adopt?"原件保持当前位置，确认后建立辅助索引。":"确认创建之前只预览位置。"}</p>
   <div className="library-actions"><button className="library-btn" data-primary disabled={!!busy||!location||!name}>创建并打开</button><button type="button" className="library-btn" disabled={!!busy} onClick={home}>取消</button></div></form></section>:null}
  {page==="rename"&&selected?<section className="library-card library-form"><h1 ref={heading} tabIndex={-1}>修改资料库名称</h1><form className="library-form" onSubmit={e=>{e.preventDefault();void rename();}}><label className="library-field">显示名称<input required value={name} disabled={!!busy} onChange={e=>setName(e.target.value)}/></label><label className="library-choice"><input type="checkbox" checked={renameFolder} disabled={!!busy||!selectedActive} onChange={e=>setRenameFolder(e.target.checked)}/>同时修改根文件夹名称</label>{!selectedActive?<p className="library-small">打开此库后才能修改根文件夹名称。</p>:null}<p className="library-path">当前：{selected.path}</p>{renameFolder?<p className="library-path">改名后：{joinFolder(selected.path.replace(/[\\/][^\\/]+$/u,""),name)}</p>:null}<div className="library-actions"><button className="library-btn" data-primary disabled={!!busy}>保存名称</button><button type="button" className="library-btn" disabled={!!busy} onClick={home}>取消</button></div></form></section>:null}
  {page==="move"&&selected?<section className="library-card library-form"><h1 ref={heading} tabIndex={-1}>迁移资料库</h1><p className="library-path">原位置：{selected.path}</p><label className="library-field">新的保存位置<input readOnly value={location}/></label><button className="library-btn" disabled={!!busy} onClick={()=>void pick("选择迁移目标父目录").then(path=>{if(path)setLocation(path);})}>选择新位置</button>{location?<p className="library-path">目标：{joinFolder(location,selected.path.replaceAll("\\","/").split("/").at(-1)??selected.name)}</p>:null}<p className="library-muted">复制并逐项校验后启用新位置。原位置的副本保留；缓存可以重新生成。</p><div className="library-actions"><button className="library-btn" data-primary disabled={!!busy||!location} onClick={()=>void move()}>开始迁移</button><button className="library-btn" disabled={!!busy} onClick={home}>取消</button></div></section>:null}
  {page==="import"?<section className="library-card library-form"><h1 ref={heading} tabIndex={-1}>从 Pixcall 导入</h1>{scan?<><p className="library-path">来源：{scan.root}</p><p>{scan.readable} 个可读取文件 · {scan.folders.length} 个文件夹 · {scan.total-scan.readable} 个缺件或仅云端</p>{scan.warnings.length?<details><summary>{scan.warnings.length} 条扫描提示</summary>{scan.warnings.map((text,i)=><p key={i}>{text}</p>)}</details>:null}<label className="library-field">目标资料库<select value={targetId} onChange={e=>setTargetId(e.target.value)}><option value="">选择已有资料库</option>{snapshot.libraries.filter(r=>!r.error).map(r=><option key={r.id} value={r.id}>{r.name} · {r.path}</option>)}</select></label><div className="library-actions"><button className="library-btn" data-primary disabled={!!busy||!targetId} onClick={()=>void startImport()}>导入到所选资料库</button><button className="library-btn" disabled={!!busy} onClick={()=>{setAdopt(false);c.setPage("create");}}>新建目标资料库</button></div><p className="library-small">保留目录和整理信息；来源只读。导入开始后可查看进度或停止。</p></>:<button className="library-btn" onClick={()=>void importSource()}>选择 Pixcall 来源</button>}</section>:null}
  {page==="guide"?<LibraryGuide controller={c}/>:null}
  {c.queued?<section className="library-card" role="status"><p>当前任务结束后将打开：{c.queued.name}</p><button className="library-btn" onClick={c.cancelQueued}>取消等待切换</button></section>:null}
  {busy?<p role="status" className="library-muted">{busy}</p>:null}
  {importing?<p className="library-muted">正在处理导入或文件核对；资料库切换、改名和迁移暂不可用。可等待完成，或停止当前任务后切换。</p>:null}
  {c.error||snapshot.error?<p className="library-error" role="alert">{c.error||snapshot.error}</p>:null}{notice?<p className="library-muted" role="status">{notice}</p>:null}
  {c.task?<LibraryTask task={c.task} onRetry={()=>{const record=snapshot.libraries.find(r=>r.id===c.task?.library_id);if(record)selectFor(record,"move");}}/>:null}
  {page==="home"?<footer className="library-footer"><button className="library-btn" disabled={!!busy} onClick={()=>{c.setPage("guide");}}>新手引导</button><span className="library-small">文件保留在你选择的普通文件夹里。</span></footer>:null}
 </main></div>;
}
