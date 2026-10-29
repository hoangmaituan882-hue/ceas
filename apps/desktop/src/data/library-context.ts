import { createContext,useContext } from "react";
import type { ActiveLibrary,ManagerPage,PendingImport } from "./library-manager";
export type LibraryContextValue={active:ActiveLibrary|null;importing:boolean;open:(page?:ManagerPage)=>void;setImporting:(value:boolean)=>void;pending:PendingImport|null;consumeImport:()=>void;scanRequested:boolean;consumeScan:()=>void;setImportStop:(stop:(()=>void)|null)=>void};
export const LibraryContext=createContext<LibraryContextValue|null>(null);
export const useLibraryContext=()=>useContext(LibraryContext);
