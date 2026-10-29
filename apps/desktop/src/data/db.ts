import {ensureParent} from "./collection-store";
import * as browser from "./browser-store";
import { callStore, getLibraryRoot, getLibrarySession, isDesktop } from "./desktop";
import { listPrimary, toItemRow } from "./primary-store";
import type { StoredItem } from "./browser-store";
import { putThumbnail } from "./thumbnail-cache";
import { loadTags, saveTags } from "./tags";
import { acceptLibraryState } from "./library-state";
import { uuidv7 } from "./uuid";
const pendingWrites=new Set<Promise<unknown>>();
export function trackRepositoryWrite<T>(write:Promise<T>):Promise<T> {
  pendingWrites.add(write);
  void write.then(()=>pendingWrites.delete(write),()=>pendingWrites.delete(write));
  return write;
}
export async function flushRepositoryWrites(){await Promise.all([...pendingWrites]);}

export type { StoredItem } from "./browser-store";
// 旧原件仅作迁移备份；桌面素材的主读写不会退回 IndexedDB。
export { getOriginal, putOriginal, allOriginals, deleteOriginals, originalStats } from "./browser-store";
export function createRepository() {
  const root = getLibraryRoot();
  const desktop = isDesktop();
  const session = getLibrarySession();
  const store=<T>(request:Record<string,unknown>)=>callStore<T>(root,request,session);
  return {
    root,session,
    allItems: () => desktop ? listPrimary(root,false,session) : browser.allItems(),
    listTrash: async () => desktop ? listPrimary(root,true,session) : (await browser.allItems(true)).filter((row)=>row.deletedSeq!==undefined),
    hasHash: (hash:string) => desktop ? store<boolean>({action:"has_hash",hash}) : browser.hasHash(hash),
    /* 每个素材的文件记录（path/state/observation）：区分「应用回收」与「磁盘删除」靠它。 */
    records: () => desktop ? store<Record<string,string>>({action:"state"}) : Promise.resolve({} as Record<string,string>),
    putItem: async (item:StoredItem, tags?:string[], sourceKey?:string,preserveManual=false) => {
      if (!desktop) { await browser.putItem(item); if(tags)saveTags({...loadTags(),[item.id]:tags});if(sourceKey&&item.relativePath)acceptLibraryState(`ceas.import-path.${sourceKey}`,item.relativePath);return; }
      if(item.relativePath)await ensureParent(root,item.relativePath,session);
      await trackRepositoryWrite(store(tags ? {action:"import_item",item:toItemRow(item),tags,source_key:sourceKey,preserve_manual:preserveManual} : {action:"put",items:[toItemRow(item)]}));
      if(sourceKey&&item.relativePath&&getLibraryRoot()===root)acceptLibraryState(`ceas.import-path.${sourceKey}`,item.relativePath);
      await putThumbnail(item.hash,item.thumb).catch(()=>{ /* 可重建缓存不影响主库持久化。 */ });
    },
    patchMetadata:async(id:string,patch:{description:string;sourceUrl:string;rating:number;site?:string})=>{
      if(!desktop){const row=(await browser.allItems()).find(row=>row.id===id);if(!row)throw new Error("素材不存在");await browser.putItem({...row,...patch});return;}
      await trackRepositoryWrite(store({action:"patch_metadata",id,description:patch.description,source_url:patch.sourceUrl,rating:patch.rating,site:patch.site}));
    },
    deleteItems: async (ids:string[]) => {
      if (!desktop) return browser.deleteItems(ids);
      await trackRepositoryWrite(store<number>({action:"delete",ids,task_id:uuidv7()}));
      return ids;
    },
    /* 彻底删除：应用回收项会真的删掉回收区文件，磁盘删除项只删记录（字节计 0）。 */
    purgeItems: async (ids:string[]) => {
      if (!desktop) return {removed:0,bytes:0};
      return trackRepositoryWrite(store<{removed:number;bytes:number}>({action:"purge",ids}));
    },
    emptyTrash: async () => {
      if (!desktop) return {removed:0,bytes:0};
      return trackRepositoryWrite(store<{removed:number;bytes:number}>({action:"empty_trash"}));
    },
    /* 把回收记录的整理信息合并到另一份素材：原件已经没了，只能搬整理信息。 */
    mergeInto: async (source:string,target:string) => {
      if (!desktop) return {tags:0};
      return trackRepositoryWrite(store<{tags:number}>({action:"merge_into",source,target}));
    },
    /* 文件回到原样：清墓碑、恢复地址，不新增素材。 */
    reviveItem: async (id:string,path:string) => {
      if (!desktop) return;
      await trackRepositoryWrite(store({action:"revive_item",id,path}));
    },
    restoreItems: async (ids:string[],folder?:string) => {
      if (!desktop) return browser.restoreItems(ids);
      const preview=await store<{target:string}[]>({action:"restore_preview",ids,folder});
      for(const row of preview)await ensureParent(root,row.target,session);
      await trackRepositoryWrite(store({action:"restore",ids,folder,task_id:uuidv7()}));
    },
  };
}
export const allItems = () => createRepository().allItems();
export const hasHash = (hash:string) => createRepository().hasHash(hash);
export const putItem = (item:StoredItem) => createRepository().putItem(item);
export const deleteItems = (ids:string[]) => createRepository().deleteItems(ids);
export const restoreItems = (ids:string[]) => createRepository().restoreItems(ids);
export const countItems = async () => (await allItems()).length;
export const clearItems = async () => { await deleteItems((await allItems()).map((item)=>item.id)); };
