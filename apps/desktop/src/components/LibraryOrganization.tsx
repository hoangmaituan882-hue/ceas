import {ensureCollections} from "@/data/collection-store";
import {getLibrarySession} from "@/data/desktop";
import { useEffect, useRef, useState } from "react";
import { normalizeLibraryPath } from "@ceas/core/library-path";
import { createLibraryFolder, getLibraryRoot, isDesktop } from "@/data/desktop";
import { loadFolders, loadTagGroups, saveFolders, saveTagGroups } from "@/data/collections";
import { uuidv7 } from "@/data/uuid";
import "./library-organization.css";

export function LibraryOrganization({mode,onClose,initialName}:{mode:"folder"|"groups";onClose:()=>void;/* 侧栏「新建子收藏集」预填 `父/`，省得用户自己敲层级 */initialName?:string}) {
  const [name,setName]=useState(initialName??""),[color,setColor]=useState(""),[tags,setTags]=useState("");
  const [groups,setGroups]=useState(loadTagGroups),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [selectedGroupId,setSelectedGroupId]=useState<string>();
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{const previous=document.activeElement;dialog.current?.querySelector<HTMLInputElement>("input")?.focus();return()=>{if(previous instanceof HTMLElement)previous.focus();};},[]);
  const save=async()=>{
    setBusy(true);setError("");
    try {
      if(mode==="folder"){
        const path=normalizeLibraryPath(name.trim());
        if(isDesktop()){await createLibraryFolder(getLibraryRoot(),path);await ensureCollections(getLibraryRoot(),path,getLibrarySession());}
        await saveFolders([...loadFolders(),path]);
      }else{
        if(color&&!/^#[\da-f]{6}$/iu.test(color))throw new Error("颜色请输入完整的六位十六进制色值，或留空");
        if(!name.trim())throw new Error("请输入标签组名称");
        const existing=groups.find((group)=>group.id===selectedGroupId);
        if(groups.some((group)=>group.name===name.trim()&&group.id!==existing?.id))throw new Error("标签组名称已存在，请选择该组后编辑");
        const group={id:existing?.id??uuidv7(),name:name.trim(),color:color||undefined,tags:[...new Set(tags.split(/[,，\n]/u).map((tag)=>tag.trim()).filter(Boolean))]};
        const next=[...groups.filter((entry)=>entry.id!==group.id),group];await saveTagGroups(next);setGroups(next);
      }
      onClose();
    }catch(reason){setError(String(reason));}finally{setBusy(false);}
  };
  return <div className="organization-mask" onPointerDown={()=>{if(!busy)onClose();}}>
    <div ref={dialog} className="organization-dialog" role="dialog" aria-modal="true" aria-label={mode==="folder"?"新建收藏集":"管理标签组"}
      onPointerDown={(event)=>event.stopPropagation()} onKeyDown={(event)=>{
        if(event.key==="Escape"){event.stopPropagation();if(!busy)onClose();}
        if(event.key==="Tab"){
          const fields=[...event.currentTarget.querySelectorAll<HTMLElement>('input,button:not(:disabled)')];const first=fields[0],last=fields.at(-1);
          if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
        }
      }}>
      <strong>{mode==="folder"?"新建收藏集":"管理标签组"}</strong>
      {mode==="groups"&&groups.length>0?<div className="organization-existing">{groups.map((group)=><button type="button" className="query-action" key={group.id} onClick={()=>{setSelectedGroupId(group.id);setName(group.name);setColor(group.color??"");setTags(group.tags.join("，"));}}>{group.name}</button>)}</div>:null}
      <form className="query-fields" onSubmit={(event)=>{event.preventDefault();void save();}}>
        <label className="query-field"><span>{mode==="folder"?"文件夹名称（可用 / 创建子集）":"标签组名称"}</span><input required value={name} onChange={(event)=>setName(event.target.value)}/></label>
        {mode==="groups"?<>
          <label className="query-field"><span>颜色（六位十六进制，可留空）</span><input value={color} onChange={(event)=>setColor(event.target.value)}/></label>
          <label className="query-field"><span>标签（逗号分隔）</span><input value={tags} onChange={(event)=>setTags(event.target.value)}/></label>
        </>:<p className="query-help">收藏集会创建为资料库内的同名普通文件夹。</p>}
        {error?<p className="query-error" role="alert">{error}</p>:null}
        <div className="organization-existing"><button type="submit" className="query-action" disabled={busy}>{busy?"正在保存…":"保存"}</button><button type="button" className="query-action" disabled={busy} onClick={onClose}>取消</button></div>
      </form>
    </div>
  </div>;
}
