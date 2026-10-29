import { useState } from "react";
import { parentPath } from "@ceas/core/library-path";
import type { Item } from "@/data/items";
import { getLibraryRoot, isDesktop, revealInExplorer } from "@/data/desktop";
export type MetadataPatch = {description:string;sourceUrl:string;rating:number};
export function FileMetadata({item,tags,onSave,onSimilarColor}:{item:Item;tags:readonly string[];onSave?:(patch:MetadataPatch)=>Promise<void>;onSimilarColor?:(color:string)=>void}) {
  const [description,setDescription]=useState(item.description??""),[sourceUrl,setSourceUrl]=useState(item.sourceUrl??""),[rating,setRating]=useState(item.rating??0);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  return <>
    {item.fileState&&item.fileState!=="ready"?<p className="query-help" role="status">{item.fileState==="missing"?"原件缺失，整理信息已保留。可在文件核对面板重新关联。":item.fileState==="pending"?"内容更新尚未完成，请在文件核对面板重试。":item.fileState==="decode"?"内容无法解码（文件损坏或格式不支持）。可在文件核对面板按普通文件保留。":"原件暂不可读取，请检查磁盘或权限后重试。"}</p>:null}
    <dl className="panel-meta"><div><dt>文件名</dt><dd>{item.originalName??item.name}</dd></div><div><dt>收藏集</dt><dd>{item.relativePath?(parentPath(item.relativePath)||"收件箱"):"旧版资料（待整理）"}</dd></div></dl>
    <form className="metadata-form" onSubmit={(event)=>{event.preventDefault();if(!onSave)return;setBusy(true);setMessage("");void onSave({description,sourceUrl,rating}).then(()=>setMessage("已保存"),(reason:unknown)=>setMessage(String(reason))).finally(()=>setBusy(false));}}>
      <label className="query-field"><span>描述</span><input value={description} disabled={!onSave||busy} onChange={(event)=>setDescription(event.target.value)}/></label>
      <label className="query-field"><span>来源网址</span><input type="url" value={sourceUrl} disabled={!onSave||busy} onChange={(event)=>setSourceUrl(event.target.value)}/></label>
      <label className="query-field"><span>评分</span><select aria-label="评分" value={rating} disabled={!onSave||busy} onChange={(event)=>setRating(Number(event.target.value))}>{[0,1,2,3,4,5].map((value)=><option key={value} value={value}>{value?`${value} 星`:"未评分"}</option>)}</select></label>
      {onSave?<button type="submit" className="query-action" disabled={busy}>{busy?"保存中…":"保存元数据"}</button>:null}
      {message?<p className="query-help" role="status">{message}</p>:null}
    </form>
    {tags.length?<div className="panel-tags">{tags.map((tag)=><span className="chip" key={tag}>{tag}</span>)}</div>:null}
    {isDesktop()&&item.relativePath?<button type="button" className="query-action" onClick={()=>{void revealInExplorer(`${getLibraryRoot()}/${item.storedPath?`.ceas/${item.storedPath}`:item.relativePath}`).catch((reason:unknown)=>setMessage(String(reason)));}}>在电脑文件夹中显示</button>:null}
    {item.palette?.length?<div className="organization-existing" aria-label="图片颜色索引">{item.palette.map((color)=><button type="button" className="palette-sample" style={{background:color}} key={color} aria-label={`查找相似颜色 ${color}`} onClick={()=>onSimilarColor?.(color)}/>)}</div>:null}
  </>;
}
