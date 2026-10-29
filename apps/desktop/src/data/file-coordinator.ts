import {reconcileCollections,directoryTasks} from "./collection-store";
import {planFileReconciliation,readFileRecords,sameObservation,type DiskEntry,type FileMatch} from "@ceas/core/file-reconcile";
import {callStore,fingerprintLibraryFile,scanLibraryFiles,type DiskScan} from "./desktop";
import {classifyImportFailure} from "./import-failure";
import {loadFolders,saveFolders} from "./collections";
import type {ItemRow} from "./primary-store";
import type {ImportOptions,ImportProgress,ImportSource} from "./importer";
export type RecoveryIssue={key:string;id:string;kind:string;source:string;target:string;message:string;cancellable:boolean;retargetable:boolean};
export type FileIssue={key:string;id?:string;path:string;message:string;kind:"missing"|"unreadable"|"pending"|"decode"|"ambiguous"|"unstable"|"scan"|"missing-mass"|"import";candidates?:string[];candidateLabels?:string[];ids?:string[];collectionId?:string;retryable?:boolean};
export type FileStatus={phase:"idle"|"checking"|"processing"|"failed";mode:string;checkedAt?:number;issues:FileIssue[];tasks:RecoveryIssue[];error?:string;ignored?:number};
export const INITIAL_FILE_STATUS:FileStatus={phase:"idle",mode:"polling",issues:[],tasks:[]};
/* 核对只需要这几样：库标识 + 读回收站（判复活）+ 复活。不要整包依赖内部实现。 */
type Repository={
 root:string;session:string;
 listTrash:()=>Promise<{id:string;hash:string;relativePath?:string|null}[]>;
 reviveItem:(id:string,path:string)=>Promise<void>;
};
const norm=(path:string)=>path.replaceAll("\\","/").toLowerCase();
export const fileTasks=(repository:Repository,retry=false)=>callStore<RecoveryIssue[]>(repository.root,{action:"file_tasks",retry},repository.session);
export async function coordinateFiles(repository:Repository,force:boolean,stopped:()=>boolean,run:(sources:ImportSource[],options:ImportOptions)=>Promise<ImportProgress>,processing:()=>void){
 const {root,session}=repository;
 const directoryIssues=await directoryTasks(root,session);if(directoryIssues.length)return {changed:false,issues:directoryIssues.map(task=>({key:`directory:${task.key}`,path:task.source,kind:"scan" as const,message:`收藏集任务未完成，请在管理收藏集中恢复：${task.message}`})),tasks:[],ignored:0};
 const [rows,state,first,tasks]=await Promise.all([callStore<ItemRow[]>(root,{action:"list"},session),callStore<Record<string,string>>(root,{action:"state"},session),scanLibraryFiles(root,session),fileTasks(repository)]);
 /* 用户显式忽略的文件：不再报问题，也不当删除。这是 pending 唯一的出口 ——
     解码一直失败的文件否则会永远卡在"反复重试"。 */
 const ignored=new Set(Object.keys(state).filter(key=>key.startsWith("ceas.ignored.")).map(key=>key.slice("ceas.ignored.".length)));
 const records=readFileRecords(state),byPath=new Map(rows.map(row=>[norm(row.relative_path??records[row.id]?.path??""),row]));
 const labels=new Map(rows.map(row=>[row.id,row.relative_path??records[row.id]?.path??row.id]));
 const byIdentity=new Map<string,ItemRow[]>();
 for(const row of rows){const identity=records[row.id]?.identity;if(identity){const list=byIdentity.get(identity)??[];list.push(row);byIdentity.set(identity,list);}}
 const known=(entry:DiskEntry)=>{const list=entry.identity?byIdentity.get(entry.identity):undefined;return list?.length===1?list[0]:byPath.get(norm(entry.rel_path));};
 const blockedIds=new Set(tasks.map(task=>task.id));
 const blockedPaths=new Set(tasks.flatMap(task=>[...(task.kind!=="restore"?[norm(task.source)]:[]),...(task.kind!=="trash"?[norm(task.target)]:[])]));
 const unsettled=force||first.entries.some(entry=>{const row=known(entry),record=row?records[row.id]:undefined;return !sameObservation(record,entry)||record?.path!==entry.rel_path;});
 let scan:DiskScan=first;
 if(unsettled){await new Promise(resolve=>window.setTimeout(resolve,750));if(stopped())return {changed:false,issues:[],tasks,ignored:first.ignored};scan=await scanLibraryFiles(root,session);}
 await reconcileCollections(root,session,scan);
 const before=new Map(first.entries.map(entry=>[norm(entry.rel_path),entry])),entries:DiskEntry[]=[],issues:FileIssue[]=[];
 /* 内容解不开的条目（`decode`）不再每轮重算哈希：文件没动过就是同一个结论。
     两边都摘出去 —— 行不参与「缺失」判定，磁盘项不参与导入 —— 才不会一边报
     「缺了」一边反复重试。文件一旦再变，观察值对不上，自动回到正常核对。 */
 const held=new Set<string>();
 for(const entry of scan.entries){
  if(stopped())return {changed:false,issues,tasks,ignored:scan.ignored};
  if(blockedPaths.has(norm(entry.rel_path)))continue;
  if(unsettled&&!sameObservation(before.get(norm(entry.rel_path)),entry)){issues.push({key:`unstable:${entry.rel_path}`,path:entry.rel_path,kind:"unstable",message:"文件仍在变化，等待下次核对"});continue;}
  try{
   const row=known(entry),record=row?records[row.id]:undefined;
   if(!force&&row&&record?.state==="decode"&&sameObservation(record,entry)){held.add(row.id);continue;}
   if(!force&&row&&record?.state==="ready"&&sameObservation(record,entry))entry.hash=row.hash;
   else{const fingerprint=await fingerprintLibraryFile(root,entry.rel_path,session);if(!sameObservation(entry,fingerprint.observation))throw new Error("文件在核对时变化，请重试");entry.hash=fingerprint.hash;}
   entries.push(entry);
  }catch(reason){issues.push({key:`read:${entry.rel_path}`,id:known(entry)?.id,path:entry.rel_path,kind:"unreadable",message:String(reason)});}
 }
 const plan=planFileReconciliation(rows.filter(row=>!blockedIds.has(row.id)&&!held.has(row.id)),entries,records);
 if(stopped())return {changed:false,issues,tasks,ignored:scan.ignored};
 /* 歧义项**不能**当删除：内容还在（只是不知道该归哪个），
    进回收站等于把人工信息扔进垃圾桶。等用户显式选择。 */
 const ambiguousIds=new Set(plan.ambiguous.flatMap(item=>item.candidates));
 const missing=plan.missing.filter(id=>records[id]?.state!=="missing"&&!ambiguousIds.has(id)&&!ignored.has(id));
 const outcome=plan.matches.length||missing.length?await callStore<{changed:number;trashed:number;blocked:number}>(root,{action:"reconcile",matches:plan.matches,missing},session):{changed:0,trashed:0,blocked:0};
 let changed=outcome.changed>0||outcome.trashed>0;
 /* 批量消失没确认时，一条都不动；把待确认的 id 带出去，由界面问一次。 */
 /* 批量消失只出一条汇总：同一收藏集下全部消失时点名，否则报总数。
    不给 N 条单项 + 1 条汇总 —— 那等于让用户读两遍同一件事。 */
 const massIds=new Set<string>();
 if(outcome.blocked>0){
  for(const id of missing)massIds.add(id);
  const groups=new Map<string,string[]>();
  for(const id of missing){const row=rows.find(item=>item.id===id);const key=row?.collection_id??"";groups.set(key,[...(groups.get(key)??[]),id]);}
  const single=groups.size===1?[...groups.values()][0]:undefined;
  const label=single?rows.find(row=>row.id===single[0])?.relative_path?.split("/").slice(0,-1).join("/"):undefined;
  issues.push({key:"mass:missing",path:label??"",kind:"missing-mass",message:label?`收藏集「${label}」在磁盘上已不存在（${outcome.blocked} 个文件），是否移入回收站？`:`检测到 ${outcome.blocked} 项在磁盘上消失，是否移入回收站？`,ids:missing,collectionId:single?rows.find(row=>row.id===single[0])?.collection_id??undefined:undefined});
 }
 let result:ImportProgress|undefined;
 /* 文件回到原样就复活原记录：同路径 + 同完整哈希 + 记录是「磁盘删除」。
    不做这一步，"撤销删除"会变成一次重复导入。 */
 const fresh=plan.imports.slice();
 if(fresh.length){
  const trashRows=await repository.listTrash();
  const backByPath=new Map(trashRows.map(row=>[norm(row.relativePath??records[row.id]?.path??""),row]));
  for(const entry of fresh){const back=backByPath.get(norm(entry.rel_path));if(!back||back.hash!==entry.hash||records[back.id]?.state!=="missing")continue;await repository.reviveItem(back.id,entry.rel_path);const at=fresh.indexOf(entry);if(at>=0)fresh.splice(at,1);changed=true;}
 }
 if(fresh.length){processing();result=await run(fresh.map(entry=>({name:entry.name,path:entry.path,relativePath:entry.rel_path,expectedHash:entry.hash})),{diskPaths:scan.entries.map(entry=>entry.rel_path)});changed=true;}
 if(stopped())return {changed,issues,tasks,ignored:scan.ignored};
 if(JSON.stringify([...loadFolders()].sort())!==JSON.stringify(scan.folders))await saveFolders(scan.folders);
 /* 更新失败的条目要在这一步落成**事实**，而不是停在一个只表示"过程"的 `pending`。
    「内容解不开」尤其如此：它不会自己变好，留成 pending 就是让用户反复点重试。 */
 for(const failure of result?.failed??[]){
  const row=byPath.get(norm(failure.name));if(!row)continue;
  const verdict=classifyImportFailure(failure.reason);
  if(verdict.state)await callStore(root,{action:"mark_file_state",id:row.id,state:verdict.state},session);
  issues.push({key:`failed:${failure.name}`,id:row.id,path:failure.name,kind:verdict.state==="decode"?"decode":"pending",message:`${verdict.text}。${verdict.hint}`});
 }
 const latest=readFileRecords(await callStore<Record<string,string>>(root,{action:"state"},session));
 /* 已被跟随删除的项已经进回收站，不再重复列在问题面板里。 */
 const trashedIds=new Set((await (outcome.trashed>0?repository.listTrash():Promise.resolve([]))).map(row=>row.id));
 for(const row of rows){const record=latest[row.id];if(!record||record.state==="ready"||blockedIds.has(row.id)||trashedIds.has(row.id)||issues.some(issue=>issue.id===row.id))continue;issues.push({key:`item:${row.id}`,id:row.id,path:record.path,kind:record.state,message:record.state==="missing"?"原件缺失，整理信息已保留":record.state==="decode"?"内容无法解码（文件损坏或格式不支持）。可按普通文件保留，或忽略此文件":record.state==="pending"?"内容更新尚未完成，请重新核对":"原件暂不可读"});}
 for(const item of plan.ambiguous)issues.push({key:`ambiguous:${item.path}`,path:item.path,candidates:item.candidates,candidateLabels:item.candidates.map(id=>labels.get(id)??id),kind:"ambiguous",message:`存在 ${item.candidateCount} 个相同内容候选${item.candidateCount>24?"，先列出 24 个，也可从缺失项手动关联":""}，未自动关联或重复导入`});
 for(const warning of scan.warnings)issues.push({key:`scan:${warning.path}`,path:warning.path,kind:"scan",message:warning.message});
 return {changed,issues,tasks:await fileTasks(repository),ignored:scan.ignored};
}
export async function associateFile(repository:Repository,id:string,path:string){
 const rows=await callStore<ItemRow[]>(repository.root,{action:"list"},repository.session),state=await callStore<Record<string,string>>(repository.root,{action:"state"},repository.session);
 const records=readFileRecords(state),item=rows.find(row=>row.id===id);if(!item)throw new Error("素材不存在或已回收");
 const entry=(await scanLibraryFiles(repository.root,repository.session)).entries.find(entry=>norm(entry.path)===norm(path)||norm(entry.rel_path)===norm(path));
 if(!entry)throw new Error("请选择资料库内可读取的普通文件；库外文件请先复制到资料库");
 if(rows.some(row=>row.id!==id&&norm(row.relative_path??"")===norm(entry.rel_path)))throw new Error("该文件已属于另一素材，未覆盖其整理信息");
 const fingerprint=await fingerprintLibraryFile(repository.root,entry.rel_path,repository.session);
 if(fingerprint.hash!==item.hash)throw new Error("所选文件与原件内容不同，未关联");
 const match:FileMatch={id,previous:item.relative_path??records[id]?.path??"",hash:item.hash,content_hash:fingerprint.hash,entry:{...entry,...fingerprint.observation}};
 await callStore(repository.root,{action:"reconcile",matches:[match],missing:[]},repository.session);
}

/* 用户确认「这些确实被删了」：只补一次 reconcile，adopt=true 让它们跟随进回收站。 */
export async function adoptMissing(repository:Repository,ids:string[]){
 if(ids.length===0)return;
 await callStore(repository.root,{action:"reconcile",matches:[],missing:ids,adopt:true},repository.session);
}

/* 内容解不开时的出口：接受磁盘上的当前字节，哈希重算、按普通文件保留。
   不给这个出口，一张改坏的图就只有「反复重试」一条路 —— 那不是选择。 */
export async function acceptContent(repository:Repository,id:string){
 await callStore(repository.root,{action:"accept_content",id},repository.session);
}

export type Relocated={mode:"moved"|"copied";files:number;bytes:number;target:string};
/* §5.3「重新定位」：收藏集目录跑到库外了，把那个目录收回库内原位置。
   收回后核对按内容哈希复活每条记录，标签与描述不用重建。 */
export const relocateCollection=(repository:Repository,id:string,source:string)=>callStore<Relocated>(repository.root,{action:"relocate_collection",id,source},repository.session);
