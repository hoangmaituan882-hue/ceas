import {useEffect,useMemo,useState} from "react";
import {folderCollections,inFolder} from "@ceas/core/library-path";
import {indexCollections,type CollectionRow} from "@ceas/core/collection-model";
import {loadFolders,loadTagGroups} from "./collections";
import {listCollections} from "./collection-store";
import {isDesktop,getLibraryRoot,getLibrarySession} from "./desktop";
import type {Item} from "./items";
export function useLibraryFolders(items:Item[]){
 const [revision,setRevision]=useState(0),[rows,setRows]=useState<CollectionRow[]>([]),[trash,setTrash]=useState<CollectionRow[]>([]);
 useEffect(()=>{const refresh=()=>setRevision(version=>version+1);window.addEventListener("ceas-folders-changed",refresh);return()=>window.removeEventListener("ceas-folders-changed",refresh);},[]);
 useEffect(()=>{if(!isDesktop())return;let alive=true;const root=getLibraryRoot(),session=getLibrarySession();void Promise.all([listCollections(root,session),listCollections(root,session,true)]).then(([rows,trash])=>{if(alive){setRows(rows);setTrash(trash);}}).catch(()=>{});return()=>{alive=false;};},[items,revision]);
 return useMemo(()=>{
  const collections=isDesktop()?rows.map(row=>({id:`collection:${row.id}`,path:row.path,label:row.name,depth:row.path.split("/").length,state:row.state})):folderCollections(items.flatMap(item=>item.relativePath?[item.relativePath]:[]),loadFolders());
  const families=indexCollections(rows),descendants=new Map([...families.descendants].map(([id,ids])=>[`collection:${id}`,ids]));
  const counts:Record<string,number>=Object.fromEntries(collections.map(collection=>[collection.id,0]));
  if(isDesktop()){for(const item of items)for(const id of families.ancestors.get(item.collectionId??"")??[]){const key=`collection:${id}`;counts[key]=(counts[key]??0)+1;}}
  else for(const collection of collections)counts[collection.id]=items.filter(item=>inFolder(item.relativePath,collection.path)).length;
  return {collections,counts,rows,trash,descendants,tagGroups:loadTagGroups()};
 },[items,revision,rows,trash]);
}
