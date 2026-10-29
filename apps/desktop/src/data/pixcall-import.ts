import {ensureCollections} from "./collection-store";
import {getLibrarySession} from "./desktop";
import { createLibraryFolder, getLibraryRoot, type PixcallEntry, type PixcallScan } from "./desktop";
import { loadFolders, loadTagGroups, saveFolders, saveTagGroups } from "./collections";
import { uuidv7 } from "./uuid";
import type { ImportSource } from "./importer";
export function pixcallTimestamp(value: string | null | undefined): number | undefined {
  if(!value)return undefined;
  const numeric=Number(value);
  const timestamp=Number.isFinite(numeric)?numeric*(Math.abs(numeric)<100_000_000_000?1000:1)
    : Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/iu.test(value)?value:`${value.replace(" ","T")}Z`);
  return Number.isFinite(timestamp)?timestamp:undefined;
}
export async function preparePixcallImport(scan: PixcallScan | PixcallEntry[]): Promise<ImportSource[]> {
  const targetRoot=getLibraryRoot();
  if(!Array.isArray(scan)) {
    const normalize=(path:string)=>path.replaceAll("\\","/").replace(/\/$/u,"").toLowerCase();
    const source=normalize(scan.root),target=normalize(targetRoot);
    if(source===target||source.startsWith(`${target}/`)||target.startsWith(`${source}/`))throw new Error("Pixcall 来源和目标资料库不能互相包含，请选择独立的位置");
    for(const path of scan.folders){await createLibraryFolder(targetRoot,path);await ensureCollections(targetRoot,path,getLibrarySession());}
    if(getLibraryRoot()!==targetRoot)throw new Error("资料库已切换，已停止导入准备");
    await saveFolders([...loadFolders(),...scan.folders]);
    const groups=loadTagGroups();
    for(const imported of scan.tag_groups){
      const existing=groups.find((group)=>group.name===imported.name);
      if(existing){existing.tags=[...new Set([...existing.tags,...imported.tags])];if(!existing.color)existing.color=imported.color;}
      else groups.push({id:uuidv7(),name:imported.name,color:imported.color,tags:imported.tags});
    }
    await saveTagGroups(groups);
  }
  const entries=Array.isArray(scan)?scan:scan.entries;
  return entries.filter((entry)=>entry.readable!==false).map((entry)=>({name:entry.name,path:entry.path,
    sourceKey:`pixcall:${Array.isArray(scan)?entry.path:scan.root}:${entry.source_id??entry.rel_path}:${entry.rel_path}`,
    relativePath:entry.rel_path,tags:entry.tags,description:entry.description,sourceUrl:entry.source_url,rating:entry.rating,
    createdAt:pixcallTimestamp(entry.created_at),modifiedAt:pixcallTimestamp(entry.modified_at)}));
}
