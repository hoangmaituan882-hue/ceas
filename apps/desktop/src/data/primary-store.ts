import { callStore, getLibraryRoot, getLibrarySession, loadBlob } from "./desktop";
import type { StoredItem } from "./browser-store";
import { getThumbnail, putThumbnail } from "./thumbnail-cache";
import { readFileRecords } from "@ceas/core/file-reconcile";

export type ItemRow = {
  collection_id?:string|null;id:string; hash:string; name:string; w:number; h:number; bytes:number;
  kind:string; duration?:number|null; ext?:string|null; color?:string|null;
  created_at:number; site?:string|null;
  deleted_seq?:number;
  relative_path?:string|null; description?:string; source_url?:string;
  rating?:number; palette?:string[]; modified_at?:number|null;
};
export function toItemRow(item: StoredItem): ItemRow {
  return { id:item.id,hash:item.hash,name:item.name,w:item.w,h:item.h,bytes:item.bytes,
    kind:item.kind??"image",duration:item.duration,ext:item.ext??item.name.split(".").pop()?.toLowerCase(),color:item.color,created_at:item.createdAt,site:item.site,deleted_seq:item.deletedSeq,
    relative_path:item.relativePath,description:item.description??"",source_url:item.sourceUrl??"",rating:item.rating??0,palette:item.palette??[],modified_at:item.modifiedAt };
}
export async function listPrimary(root=getLibraryRoot(),trash=false,session=getLibrarySession()): Promise<StoredItem[]> {
  const [rows,state] = await Promise.all([callStore<ItemRow[]>(root,{action:trash?"trash":"list"},session),callStore<Record<string,string>>(root,{action:"state"},session)]);
  const records=readFileRecords(state);
  const result: StoredItem[] = [];
  // 缩略图是可重建缓存；素材元数据只读 SQLite，缓存失效不丢条目。
  for (const row of rows) {
    let trashRecord:{original?:string;target?:string}={};
    if(trash)try{const value:unknown=JSON.parse(state[`ceas.trash.${row.id}`]??"{}");if(value&&typeof value==="object")trashRecord=value;}catch{/* 损坏回收记录保留可见，恢复时明确报错。 */}
    const relativePath=trashRecord.original??row.relative_path??records[row.id]?.path;
    const cached = await getThumbnail(row.hash).catch(()=>undefined);
    let thumb = cached;
    if (!thumb) { try {
      const original = row.kind === "file" ? null : await loadBlob(row.hash,row.ext??"",root,relativePath,session,row.id);
      if (original && row.kind === "image") {
        const { makeThumb } = await import("./thumbnail");
        const image = await createImageBitmap(original);
        try { thumb = await makeThumb(image); } finally { image.close(); }
      } else if (original && row.kind === "video") {
        const { probeVideo } = await import("./importer");
        thumb = (await probeVideo(original)).poster;
      }
    } catch { /* 原件缺失或损坏只影响此图预览，不隐藏其它素材。 */ } }
    const item: StoredItem = { id:row.id,hash:row.hash,name:row.name,w:row.w,h:row.h,bytes:row.bytes,
      kind:row.kind==="video"?"video":row.kind==="file"?"file":"image",duration:row.duration??undefined,ext:row.ext??undefined,
      color:row.color??"",createdAt:row.created_at,site:row.site??undefined,
      relativePath,collectionId:row.collection_id??undefined,fileState:trash?undefined:records[row.id]?.state,storedPath:trashRecord.target,description:row.description,sourceUrl:row.source_url,rating:row.rating,palette:row.palette,modifiedAt:row.modified_at??undefined,deletedSeq:row.deleted_seq??undefined,
      thumb:thumb??new Blob([], {type:"image/webp"}) };
    if (thumb&&!cached) await putThumbnail(row.hash,thumb).catch(() => { /* 缓存可重建，不改变主库提交结果。 */ });
    result.push(item);
  }
  return result;
}
