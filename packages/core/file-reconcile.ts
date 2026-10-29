export type Observation={size:number;stamp:string;identity?:string|null};
export type FileRecord=Observation&{path:string;state:"ready"|"pending"|"missing"|"unreadable"|"decode"};
export type DiskEntry=Observation&{name:string;rel_path:string;path:string;hash?:string};
export type IndexedFile={id:string;hash:string;relative_path?:string|null};
export type FileMatch={id:string;previous:string;hash:string;content_hash:string;entry:DiskEntry};
export type FileAmbiguity={path:string;candidates:string[];candidateCount:number};
const key=(path:string)=>path.replaceAll("\\","/").toLowerCase();
export function sameObservation(a:Observation|undefined,b:Observation):boolean{
 return !!a&&a.size===b.size&&a.stamp===b.stamp&&(a.identity??null)===(b.identity??null);
}
export function readFileRecords(state:Record<string,string>):Record<string,FileRecord>{
 const records:Record<string,FileRecord>={};
 for(const [name,value]of Object.entries(state))if(name.startsWith("ceas.file.")){
  try{const record=JSON.parse(value) as Partial<FileRecord>;if(typeof record.path==="string"&&typeof record.stamp==="string"&&typeof record.size==="number"&&typeof record.state==="string")records[name.slice(10)]=record as FileRecord;}catch{/* 无效观察记录仅触发重新核对，不丢弃人工信息。 */}
 }
 return records;
}
function group<T>(values:readonly T[],by:(value:T)=>string|undefined|null):Map<string,T[]>{
 const groups=new Map<string,T[]>();for(const value of values){const id=by(value);if(id){const current=groups.get(id);if(current)current.push(value);else groups.set(id,[value]);}}return groups;
}
export function planFileReconciliation(items:readonly IndexedFile[],entries:readonly DiskEntry[],records:Record<string,FileRecord>){
 const matched=new Map<string,DiskEntry>(),taken=new Set<string>();
 const pathOf=(item:IndexedFile)=>item.relative_path??records[item.id]?.path;
 const byIdentity=group(items,item=>records[item.id]?.identity),diskIdentity=group(entries,entry=>entry.identity);
 const assign=(item:IndexedFile,entry:DiskEntry)=>{matched.set(item.id,entry);taken.add(key(entry.rel_path));};
 // 文件身份比地址更强：交换名字、旧地址放入新文件，也要保留原对象的整理信息。
 for(const [identity,candidates]of byIdentity){const found=diskIdentity.get(identity);if(candidates.length===1&&found?.length===1&&candidates[0]&&found[0])assign(candidates[0],found[0]);}
 const byPath=new Map(items.flatMap(item=>{const path=pathOf(item);return path?[[key(path),item] as const]:[];}));
 for(const entry of entries){
  if(taken.has(key(entry.rel_path)))continue;
  const item=byPath.get(key(entry.rel_path));if(item&&!matched.has(item.id))assign(item,entry);
 }
 const absent=items.filter(item=>!matched.has(item.id)),fresh=entries.filter(entry=>!taken.has(key(entry.rel_path)));
 const missingHash=group(absent,item=>item.hash),freshHash=group(fresh,entry=>entry.hash);
 const ambiguous:FileAmbiguity[]=[];
 for(const [hash,candidates]of missingHash){
  const found=freshHash.get(hash);if(!found?.length)continue;
  if(candidates.length===1&&found.length===1&&candidates[0]&&found[0])assign(candidates[0],found[0]);
  else {const suggestions=candidates.slice(0,24).map(item=>item.id);for(const entry of found)ambiguous.push({path:entry.rel_path,candidates:suggestions,candidateCount:candidates.length});}
 }
 const blocked=new Set(ambiguous.map(entry=>key(entry.path)));
 const matches:FileMatch[]=[];const imports:DiskEntry[]=[];
 for(const item of items){
  const entry=matched.get(item.id),previous=pathOf(item);if(!entry||!previous)continue;
  const contentHash=entry.hash??item.hash;
  if(contentHash!==item.hash||previous!==entry.rel_path||item.relative_path==null||records[item.id]?.path!==entry.rel_path||records[item.id]?.state!=="ready"||!sameObservation(records[item.id],entry))matches.push({id:item.id,previous,hash:item.hash,content_hash:contentHash,entry});
  if(contentHash!==item.hash)imports.push(entry);
 }
 for(const entry of entries)if(!taken.has(key(entry.rel_path))&&!blocked.has(key(entry.rel_path)))imports.push(entry);
 return {matches,imports,missing:items.filter(item=>!matched.has(item.id)).map(item=>item.id),ambiguous};
}
