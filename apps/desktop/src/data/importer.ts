import { dominantColor, imagePalette, makeThumb } from "./thumbnail";
import { probeVideo } from "./video-probe";
import { createRepository, putOriginal, type StoredItem } from "./db";
import { uuidv7 } from "./uuid";
import { callStore, isDesktop, readBinary, saveOriginalFile } from "./desktop";
import { normalizeLibraryPath } from "@ceas/core/library-path";
import { loadTags, type TagMap } from "./tags";
import { readLibraryState } from "./library-state";
export { probeVideo } from "./video-probe";

export type ImportProgress = {
  done: number; total: number; imported: number; duplicated: number; updated: number;
  failed: { name: string; reason: string }[]; running: boolean; cancelled?:boolean;
};
export type ImportHandle = {
  promise: Promise<ImportProgress>; pause: () => void; resume: () => void; cancel: () => void;
  subscribe: (fn: (p: ImportProgress) => void) => () => void;
};
export type ImportSource = {
  url?: string; path?: string; name: string; revoke?: boolean; tags?: string[];
  relativePath?: string; description?: string; sourceUrl?: string; rating?: number;
  createdAt?: number; modifiedAt?: number;
  sourceKey?: string;
  expectedHash?:string;
};
export type ImportOptions = { onImported?: (id: string, src: ImportSource) => void | Promise<void>; diskPaths?: readonly string[] };
const MIME: Record<string, string> = {
  jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",avif:"image/avif",bmp:"image/bmp",svg:"image/svg+xml",
  mp4:"video/mp4",m4v:"video/mp4",webm:"video/webm",ogv:"video/ogg",mov:"video/quicktime",
};
export function isImportable(name: string, _contentType = ""): boolean { return name.length > 0 && !name.startsWith("."); }
export const isVideo = (name: string, mime: string) => mime.startsWith("video/") || /\.(mp4|m4v|webm|ogv|mov)$/iu.test(name);
async function hashBytes(buf: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",buf))].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
}

function run(sources: ImportSource[], options: ImportOptions = {}): ImportHandle {
  const repository = createRepository();
  const desktop = isDesktop();
  let paused = false, cancelled = false;
  const wakes = new Set<() => void>();
  const listeners = new Set<(progress: ImportProgress) => void>();
  const progress: ImportProgress = {done:0,total:sources.length,imported:0,duplicated:0,updated:0,failed:[],running:true};
  const emit = () => listeners.forEach((listener)=>listener({...progress,failed:[...progress.failed]}));
  const wake = () => { wakes.forEach((resolve)=>resolve()); wakes.clear(); };
  const wait = async () => { while(paused && !cancelled) await new Promise<void>((resolve)=>wakes.add(resolve)); };
  const locks = new Map<string,Promise<void>>();
  const hashLocks = new Map<string,Promise<void>>();
  const mappings:Record<string,string>={};
  try{const value:unknown=JSON.parse(readLibraryState("ceas.import-paths.v1")??"{}");if(typeof value==="object"&&value!==null)for(const [key,path]of Object.entries(value))if(typeof path==="string")mappings[key]=path;}catch{/* 未写入过映射的旧库从空表开始。 */}
  const initial = Promise.all([
    repository.allItems(), repository.listTrash(),
    desktop?callStore<string[]>(repository.root,{action:"hidden_ids"},repository.session):Promise.resolve([] as string[]),
    desktop ? callStore<TagMap>(repository.root,{action:"tags"},repository.session) : Promise.resolve(loadTags()),
    desktop ? callStore<Record<string,string>>(repository.root,{action:"state"},repository.session) : Promise.resolve({} as Record<string,string>),
  ]).then(([visible,deleted,hiddenIds,tags,committedState])=>({
    paths:new Map(visible.filter((row)=>row.relativePath).map((row)=>[row.relativePath?.toLowerCase()??"",row])),
    hashes:new Set(visible.map((row)=>row.hash)), byId:new Map([...visible,...deleted].map(row=>[row.id,row])),hiddenIds:new Set(hiddenIds),tags, committedState,
  }));

  const process = async (source: ImportSource) => {
    const state = await initial;
    const mappingKey=`ceas.import-path.${source.sourceKey}`;
    const sourceId=source.sourceKey?state.committedState[`ceas.import-id.${source.sourceKey}`]:undefined;
    if(sourceId&&(state.hiddenIds.has(sourceId)||state.byId.get(sourceId)?.deletedSeq!==undefined)){progress.duplicated++;return;}
    // 移动操作可在原生层更新映射；每次导入从主库读，不能使用旧页面的镜像地址。
    const owner=sourceId?state.byId.get(sourceId):undefined;
    const mapped=owner?.relativePath??(source.sourceKey?(desktop?state.committedState[mappingKey]:readLibraryState(mappingKey))??mappings[source.sourceKey]:undefined);
    const requested = normalizeLibraryPath(mapped ?? source.relativePath ?? source.name);
    const buf = source.path ? await readBinary(source.path) : await (async()=>{
      const response = await fetch(source.url ?? "");
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })();
    if(cancelled)return;
    const hash = await hashBytes(buf);
    if(source.expectedHash&&source.expectedHash!==hash)throw new Error("文件在核对后又发生变化，稍后重试");
    const persist=async()=>{
    let previous = source.relativePath ? state.paths.get(requested.toLowerCase()) : undefined;
    if(previous?.deletedSeq !== undefined) { progress.duplicated++; return; }
    if(previous&&previous.hash!==hash&&!options.diskPaths)previous=undefined;
    const tags = [...new Set([...(previous ? state.tags[previous.id]??[] : []),...source.tags??[]])];
    if(previous?.hash === hash) {
      // 已关联的来源重试只补索引与标签，不用旧库描述覆盖用户刚编辑的资料。
      const item:StoredItem = {...previous};
      if(!mapped)Object.assign(item,{description:source.description??previous.description,sourceUrl:source.sourceUrl??previous.sourceUrl,
        rating:source.rating??previous.rating,modifiedAt:source.modifiedAt??previous.modifiedAt});
      if(previous.kind==="image"&&!previous.palette?.length){
        const image=await createImageBitmap(new Blob([buf],{type:MIME[previous.ext??""]??"application/octet-stream"}));
        try{item.palette=imagePalette(image);}finally{image.close();}
      }
      const renamed=!!options.diskPaths&&previous.relativePath!==requested;
      if(renamed){if(previous.relativePath)state.paths.delete(previous.relativePath.toLowerCase());item.relativePath=requested;item.name=source.name;}
      await repository.putItem(item,tags,source.sourceKey,!!options.diskPaths);
      state.tags[item.id] = tags;state.paths.set(requested.toLowerCase(),item);
      if(renamed)progress.updated++;else progress.duplicated++; return;
    }
    // 未指定路径的散文件沿用去重；带目录的导入保留每个文件位置。
    if(!source.relativePath && state.hashes.has(hash)){progress.duplicated++;return;}
    const ext = source.name.split(".").pop()?.toLowerCase() ?? "bin";
    const original = new Blob([buf],{type:MIME[ext]??"application/octet-stream"});
    const item: StoredItem = {id:previous?.id??uuidv7(),hash,name:source.name,w:1,h:1,bytes:buf.byteLength,color:"",thumb:new Blob(),
      createdAt:source.createdAt??previous?.createdAt??(source.sourceKey?0:Date.now()),modifiedAt:source.modifiedAt??previous?.modifiedAt,ext,kind:"file",
      description:source.description??previous?.description,sourceUrl:source.sourceUrl??previous?.sourceUrl,rating:source.rating??previous?.rating??0,palette:[]};
    try{item.site=item.sourceUrl?new URL(item.sourceUrl).hostname:undefined;}catch{/* 旧版任意来源文本仍保留、仍可搜索。 */}
    if(isVideo(source.name,original.type)) {
      const meta = await probeVideo(original);
      Object.assign(item,{w:meta.w,h:meta.h,duration:meta.duration,color:meta.color,thumb:meta.poster,kind:"video"});
    } else if(original.type.startsWith("image/")) {
      const image = await createImageBitmap(original);
      try { Object.assign(item,{w:image.width,h:image.height,color:dominantColor(image),palette:imagePalette(image),
        thumb:Math.max(image.width,image.height)>512?await makeThumb(image):original,kind:"image"}); }
      finally {image.close();}
    }
    if(cancelled)return;
    if(desktop) {
      // 同路径内容变更只在磁盘扫描时索引，外库不同内容以新文件名保留双方。
      const relative = await saveOriginalFile(repository.root,requested,hash,ext,buf,source.path,repository.session);
      item.relativePath = relative;
      item.name = relative.split("/").at(-1) ?? source.name;
      if(previous && !options.diskPaths && relative.toLowerCase() !== previous.relativePath?.toLowerCase())item.id=uuidv7();
    } else {
      item.relativePath = requested;
      await putOriginal(hash,original);
    }
    await repository.putItem(item,tags,source.sourceKey,!!options.diskPaths);
    if(previous?.relativePath&&previous.id===item.id)state.paths.delete(previous.relativePath.toLowerCase());
    state.paths.set(item.relativePath.toLowerCase(),item);state.hashes.add(hash);state.tags[item.id]=tags;
    await options.onImported?.(item.id,source);
    if(previous?.id === item.id)progress.updated++; else progress.imported++;
    };
    if(source.relativePath)await persist();
    else {
      const write=(hashLocks.get(hash)??Promise.resolve()).catch(()=>{}).then(persist);
      hashLocks.set(hash,write);try{await write;}finally{if(hashLocks.get(hash)===write)hashLocks.delete(hash);}
    }
  };
  const one = async (source: ImportSource) => {
    await wait(); if(cancelled)return;
    // 同一目录地址串行，失败会释放锁；不同目录可以并行，不丢重复文件的归属。
    const key = source.relativePath?.replaceAll("\\","/").toLowerCase() ?? source.name;
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.catch(()=>{}).then(async()=>{await wait();if(!cancelled)await process(source);});
    locks.set(key,current);
    try {await current;} catch(reason){progress.failed.push({name:source.relativePath??source.name,reason:String(reason)});}
    finally {if(locks.get(key)===current)locks.delete(key);if(source.revoke&&source.url)URL.revokeObjectURL(source.url);progress.done++;emit();}
  };
  const promise = (async()=>{
    let cursor = 0;
    const worker = async()=>{while(cursor<sources.length&&!cancelled){const source=sources[cursor++];if(source)await one(source);}};
    await Promise.all(Array.from({length:3},worker));
    // 无 worker 等 initial 时也消费初始化错误，避免未处理的拒绝。
    await initial.catch((reason:unknown)=>{if(!sources.length)progress.failed.push({name:"资料库",reason:String(reason)});});
    progress.running=false;emit();return progress;
  })();
  return {promise,pause:()=>{paused=true;emit();},resume:()=>{paused=false;wake();emit();},cancel:()=>{cancelled=true;progress.cancelled=true;wake();emit();},
    subscribe:(listener)=>{listeners.add(listener);listener({...progress,failed:[...progress.failed]});return()=>{listeners.delete(listener);};}};
}
export const importSources = (sources: ImportSource[],options?:ImportOptions) => run(sources,options);
export const importUrls = (urls:string[]) => run(urls.map((url)=>({url,name:decodeURIComponent(url.split("/").at(-1)??"未命名")})));
export const importFiles = (files:File[],folder="") => run(files.map((file)=>({url:URL.createObjectURL(file),name:file.name,revoke:true,relativePath:folder?`${folder}/${file.webkitRelativePath||file.name}`:file.webkitRelativePath||undefined})));
