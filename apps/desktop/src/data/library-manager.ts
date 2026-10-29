import { invoke } from "@tauri-apps/api/core";
import type { PixcallScan } from "./desktop";
import { open } from "@tauri-apps/plugin-dialog";
export type LibraryRecord={id:string;name:string;path:string;count?:number|null;error?:string|null};
export type ActiveLibrary=LibraryRecord&{session:string};
export type LibrarySnapshot={libraries:LibraryRecord[];active:ActiveLibrary|null;guide:{step:number;done:boolean};error?:string|null};
export type TransferProgress={id:string;library_id:string;source:string;target:string;staging:string;kind:string;phase:string;running:boolean;bytes:number;total:number;files:number;completed:number;error?:string|null};
export type Probe={kind:"library"|"folder"|"missing"|"damaged"|"pixcall";path?:string;library?:LibraryRecord;error?:string};
export type ManagerPage="home"|"welcome"|"create"|"import"|"rename"|"move"|"guide";
export const libraryRequest=<T>(request:Record<string,unknown>)=>invoke<T>("library_manage",{request});
export const joinFolder=(parent:string,name:string)=>`${parent.replace(/[\\/]+$/u,"")}/${name}`;
export type PendingImport={scan:PixcallScan};
export async function pickLibraryDirectory(title:string){const selected=await open({directory:true,multiple:false,title});return typeof selected==="string"?selected:null;}
