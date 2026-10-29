import { callStore, getLibraryRoot, getLibrarySession, isDesktop } from "./desktop";

let cache: Record<string,string> = {};
const pending = new Map<string,string>();
let writing: Promise<void> | null = null;
let lastError: unknown;
let epoch=0;
export function hydrateLibraryState(values: Record<string,string>) {
  epoch+=1;
  cache = values;
  pending.clear();
  lastError = undefined;
}
export function readLibraryState(key: string): string | null {
  return isDesktop() ? cache[key] ?? null : localStorage.getItem(key);
}
/** 主库事务已提交的单键状态，只更新镜像，不能再排一次重复写入。 */
export function acceptLibraryState(key:string,value:string) {
  if(isDesktop())cache[key]=value;else localStorage.setItem(key,value);
}
function drain() {
  if (writing || pending.size === 0) return;
  const root = getLibraryRoot();
  const session = getLibrarySession();
  const generation=epoch;
  writing = (async () => {
    while (pending.size > 0 && generation===epoch) {
      const batch = [...pending]; pending.clear();
      try {
        for (const [key,value] of batch) {
          if(generation!==epoch)return;
          await callStore(root,{action:"set_state",key,value},session);
        }
        lastError = undefined;
      } catch (error) {
        if(generation!==epoch)return;
        for (const [key,value] of batch) if (!pending.has(key)) pending.set(key,value);
        lastError = error;
        window.dispatchEvent(new CustomEvent("ceas-storage-error",{detail:String(error)}));
        break;
      }
    }
  })().finally(() => { writing = null; if(generation!==epoch&&pending.size>0)drain(); });
}
export function writeLibraryState(key: string, value: string) {
  if (!isDesktop()) { localStorage.setItem(key,value); return; }
  cache[key] = value;
  pending.set(key,value);
  drain();
}
export async function flushLibraryState() {
  do {
    drain();await writing;
    if(lastError)throw lastError;
  }while(writing||pending.size>0);
}
