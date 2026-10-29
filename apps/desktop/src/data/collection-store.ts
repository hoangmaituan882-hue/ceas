import {callStore,createLibraryFolder,getLibraryRoot,getLibrarySession,scanLibraryFiles} from "./desktop";
import {planCollections,type CollectionRow} from "@ceas/core/collection-model";
import {uuidv7} from "./uuid";
export type {CollectionRow};
export const listCollections=(root=getLibraryRoot(),session=getLibrarySession(),trash=false)=>callStore<CollectionRow[]>(root,{action:"collections",trash},session);
export function collectionDrafts(path:string){const parts=path.replaceAll("\\","/").split("/").filter(Boolean);return parts.map((_,index)=>({id:uuidv7(),path:parts.slice(0,index+1).join("/")}));}
export async function ensureCollections(root:string,path:string,session:string){
 if(path)await callStore(root,{action:"ensure_collections",entries:collectionDrafts(path)},session);
}
export async function ensureParent(root:string,path:string,session:string){
 const parent=path.includes("/")?path.slice(0,path.lastIndexOf("/")):"";
 if(parent){await createLibraryFolder(root,parent,session);await ensureCollections(root,parent,session);}
}
export async function reconcileCollections(root:string,session:string,scan?:Awaited<ReturnType<typeof scanLibraryFiles>>){
 const [rows,facts]=await Promise.all([listCollections(root,session),scan??scanLibraryFiles(root,session)]);
 const plan=planCollections(rows,facts.directories,uuidv7);
 if(plan.changes.length||plan.missing.length){const changed=await callStore<number>(root,{action:"reconcile_collections",...plan},session);if(changed)window.dispatchEvent(new Event("ceas-folders-changed"));}
}
export type DirectoryPreview={id:string;original:string;target:string;files:number;folders:number;bytes:number;indexed:number;conflict:boolean;token:string};
export type DirectoryTask={key:string;id:string;source:string;staging:string;target:string;message:string;cancellable:boolean;retargetable:boolean};
export const directoryTasks=(root=getLibraryRoot(),session=getLibrarySession(),retry=false)=>callStore<DirectoryTask[]>(root,{action:"directory_tasks",retry},session);
