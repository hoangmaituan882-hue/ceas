import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRepository, trackRepositoryWrite } from "./db";
import { callStore, isDesktop } from "./desktop";
import { loadTags, saveTags, toggleTag, type TagMap } from "./tags";
import type { Item } from "./items";
import type { StoredItem } from "./db";

export function useLibraryData(fixtures: Item[]) {
  const repository=useMemo(createRepository,[]);
  const [library,setLibrary]=useState<Item[]>([]);
  const [hasLibrary,setHasLibrary]=useState(()=>isDesktop()||localStorage.getItem("ceas.mode")==="library");
  const [tags,setTags]=useState<TagMap>(()=>isDesktop()?{}:loadTags());
  const [error,setError]=useState("");
  const [trashMode,setTrashMode]=useState(false);
  const tagsRef=useRef(tags);
  const writes=useRef<Promise<void>>(Promise.resolve());
  const writeError=useRef("");
  // 同一资产复用 URL；刷新时立即 revoke 会让仍在退场的旧视图取到失效地址。
  const urls=useRef(new Map<string,string>());
  const metadata=useRef(new Map<string,StoredItem>());
  const alive=useRef(true);
  const requestVersion=useRef(0);
  const loadLibrary=useCallback(async()=>{
    const version=++requestVersion.current;
    try {
      await writes.current;
      const [rows,nextTags]=await Promise.all([trashMode?repository.listTrash():repository.allItems(), isDesktop()?callStore<TagMap>(repository.root,{action:trashMode?"trash_tags":"tags"},repository.session):Promise.resolve(loadTags())]);
      if(!alive.current||version!==requestVersion.current)return;
      for(const row of rows)if(row.thumb.size>0&&!urls.current.has(row.hash))urls.current.set(row.hash,URL.createObjectURL(row.thumb));
      metadata.current=new Map(rows.map((row)=>[row.id,row]));
      if(rows.length>0){setHasLibrary(true);if(!isDesktop())localStorage.setItem("ceas.mode","library");}
      tagsRef.current=nextTags;setTags(nextTags);setError(writeError.current);
      setLibrary(rows.map((row)=>({id:row.id,aspect:row.w/row.h,color:row.color,
        kind:row.kind==="video"?"video":row.kind==="file"?"file":"image",name:row.name.replace(/\.[^.]+$/,"").slice(0,16),
        originalName:row.name,createdAt:row.createdAt>0?row.createdAt:undefined,bytes:row.bytes,durationSeconds:row.duration,site:row.site,
        relativePath:row.relativePath,collectionId:row.collectionId,fileState:row.fileState,storedPath:row.storedPath,description:row.description,sourceUrl:row.sourceUrl,rating:row.rating,palette:row.palette,
        duration:row.duration?`${Math.floor(row.duration/60)}:${String(Math.round(row.duration)%60).padStart(2,"0")}`:undefined,
        size:`${row.w} × ${row.h}`,src:urls.current.get(row.hash)})));
    }catch(reason){if(alive.current&&version===requestVersion.current)setError(String(reason));throw reason;}
  },[repository,trashMode]);
  useEffect(()=>{
    alive.current=true;
    void loadLibrary().catch(()=>{});
    const storageError=(event:Event)=>{if(event instanceof CustomEvent)setError(String(event.detail));};
    window.addEventListener("ceas-storage-error",storageError);
    return()=>{alive.current=false;window.removeEventListener("ceas-storage-error",storageError);};
  },[loadLibrary]);
  useEffect(()=>()=>{urls.current.forEach((url)=>URL.revokeObjectURL(url));urls.current.clear();},[]);
  const toggleItemTag=(id:string,tag:string)=>{
    writes.current=trackRepositoryWrite(writes.current.then(async()=>{
      const next=toggleTag(tagsRef.current,id,tag);
      if(isDesktop())await callStore(repository.root,{action:"set_tags",id,tags:next[id]??[]},repository.session);
      else saveTags(next);
      tagsRef.current=next;writeError.current="";if(alive.current){setTags(next);setError("");}
    })).catch((reason:unknown)=>{writeError.current=`标签未保存，请重试此操作：${String(reason)}`;if(alive.current)setError(writeError.current);});
  };
  return {items:hasLibrary||trashMode?library:fixtures,hasLibrary,tags,toggleItemTag,metadata,loadLibrary,error,trashMode,setTrashMode,
    reportError:(reason:unknown)=>setError(String(reason)),repository};
}
