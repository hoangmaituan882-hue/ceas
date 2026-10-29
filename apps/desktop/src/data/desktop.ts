import { invoke } from "@tauri-apps/api/core";
import { uuidv7 } from "./uuid";
import type { DiskEntry,Observation } from "@ceas/core/file-reconcile";
import type {AcquisitionTarget} from "@ceas/core/acquisition";
import type {DragDropEvent} from "@tauri-apps/api/webview";

/* ══ 桌面能力封装 ════════════════════════════════════════════
   所有 invoke 都收在这里，组件不直接碰 @tauri-apps/api。
   浏览器里（没有 Tauri 运行时）返回 null，调用方自行降级。
   ------------------------------------------------------------ */

export const isDesktop = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

let activeRoot = "";
let activeSession = "";
export const getLibraryRoot = () => activeRoot;
export const getLibrarySession = () => activeSession;
export const bindLibraryRoot = (root:string,session="") => {activeRoot=root;activeSession=session;};
export type AcquisitionPlan={sources:{name:string;path:string;relative_path:string|null}[];folders:string[];warnings:{path:string;message:string}[]};
export const prepareAcquisition=(root:string,session:string,paths:string[],target:AcquisitionTarget)=>invoke<AcquisitionPlan>("prepare_acquisition",{libraryRoot:root,librarySession:session,paths,target:target.path,collectionId:target.collectionId});
export const clipboardFilePaths=(root:string,session:string)=>invoke<string[]>("clipboard_file_paths",{libraryRoot:root,librarySession:session});
export async function onNativeDrop(callback:(event:DragDropEvent)=>void){
 const {getCurrentWebview}=await import("@tauri-apps/api/webview");
 return getCurrentWebview().onDragDropEvent(event=>callback(event.payload));
}
export function callStore<T>(root:string,request:Record<string,unknown>,session=activeSession):Promise<T>{
 return invoke<T>("library_store",{libraryRoot:root,librarySession:session,request});
}
export async function revealInExplorer(path: string): Promise<void> {
  await invoke("reveal_in_explorer", { path });
}

/* ── 原图落盘 ────────────────────────────────────────────────
   Tauri 的 IPC 传字节用 base64：分块转换，避免大文件时
   String.fromCharCode(...arr) 撑爆调用栈。 */

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/* 显式绑定 ArrayBuffer：TS 5.7 起 Uint8Array<ArrayBufferLike> 不能直接当 BlobPart */
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 扩展名 → MIME：从磁盘读回的 Blob 必须带类型，否则 <video> 播不了 */
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
};

export async function loadBlob(hash: string, ext: string, root = activeRoot, relativePath?: string, session=activeSession,itemId?:string): Promise<Blob | null> {
  try {
    const b64 = await invoke<string>("load_blob", { hash, ext, libraryRoot: root, librarySession:session, relativePath:relativePath??"",itemId });
    return new Blob([fromBase64(b64)], { type: EXT_MIME[ext] ?? "application/octet-stream" });
  } catch {
    return null;
  }
}

/* ── Pixcall 资料库 ────────────────────────────────────────
   Pixcall 的库 = 普通目录树 + .pixcall/database/main.db。
   这里只读：扫描不出库、不写对方数据库。 */

export type PixcallEntry = {
  source_id?: string;
  name: string;
  rel_path: string;
  path: string;
  tags: string[];
  size: number;
  content_type: string;
  readable?: boolean;
  description?: string;
  source_url?: string;
  rating?: number;
  created_at?: string | null;
  modified_at?: string | null;
};
export type TagGroup = { id: string; name: string; color?: string | null; tags: string[] };

export type PixcallScan = {
  root: string;
  total: number;
  readable: number;
  tag_count: number;
  entries: PixcallEntry[];
  folders: string[];
  tag_groups: { source_id: string; name: string; color?: string | null; tags: string[] }[];
  warnings: string[];
  truncated: boolean;
};

export async function pixcallScan(root: string): Promise<PixcallScan | null> {
  if (!isDesktop()) return null;
  return invoke<PixcallScan>("pixcall_scan", { root, limit: 0 });
}

export const createLibraryFolder = (root: string, relativePath: string,session=activeSession) => invoke<string>("create_library_folder", {libraryRoot: root, librarySession:session, relativePath});
export const moveLibraryItem = async(root: string, id:string, relativePath:string,session=activeSession) => {await (await import("./collection-store")).ensureParent(root,relativePath,session);return invoke<string>("move_library_item", {libraryRoot:root,librarySession:session,id,relativePath,taskId:uuidv7()});};
export const exportLibraryCatalog = (root:string) => invoke<string>("export_library_catalog", {libraryRoot:root,librarySession:activeSession});
export type DiskScan={entries:DiskEntry[];folders:string[];directories:{path:string;identity:string|null}[];warnings:{path:string;message:string}[];ignored:number};
export const scanLibraryFiles = (root: string,session=activeSession) => invoke<DiskScan>("scan_library_files", {libraryRoot: root,librarySession:session});
export const fingerprintLibraryFile=(root:string,relativePath:string,session=activeSession)=>invoke<{hash:string;observation:Observation}>("fingerprint_library_file",{libraryRoot:root,librarySession:session,relativePath});
export const watchLibrary=(root:string,session=activeSession)=>invoke<{changed:boolean;mode:string;error?:string|null}>("watch_library",{libraryRoot:root,librarySession:session});
/** Pixcall 原件复制只传路径；File / URL 入口暂复用既有字节传输。 */
export function saveOriginalFile(root: string, relativePath: string, hash: string, ext: string, bytes: ArrayBuffer, source?: string, session=activeSession): Promise<string> {
  return source ? invoke<string>("copy_library_file", {libraryRoot: root, librarySession:session, source, relativePath, hash})
    : invoke<string>("save_blob", {libraryRoot: root, librarySession:session, relativePath, hash, ext, data: toBase64(bytes)});
}

/** 读磁盘文件为 ArrayBuffer（走 base64） */
export async function readBinary(path: string): Promise<ArrayBuffer> {
  const b64 = await invoke<string>("read_binary", { path });
  const bytes = fromBase64(b64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
