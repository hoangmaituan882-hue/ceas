import { useMemo, type ReactNode } from "react";
import { isDesktop } from "@/data/desktop";
import { useLibraryController } from "@/data/use-library-controller";
import { LibraryContext } from "@/data/library-context";
import { LibraryManager } from "./LibraryManager";

export function LibraryBoundary({ children }: {children: ReactNode}) {
  const controller=useLibraryController();
  const {snapshot,open,importing,setImporting,pending,consumeImport,scanRequested,consumeScan,setImportStop}=controller;
  const context=useMemo(()=>({active:snapshot.active,open,importing,setImporting,pending,consumeImport,scanRequested,consumeScan,setImportStop}),[snapshot.active,open,importing,setImporting,pending,consumeImport,scanRequested,consumeScan,setImportStop]);
  if(!isDesktop())return <>{children}</>;
  if(!controller.loaded)return <div className="empty" role="status"><p className="empty-title">正在读取资料库列表…</p></div>;
  const managerVisible=controller.opened||!snapshot.active;
  return <LibraryContext.Provider value={context}>
    {snapshot.active?<div key={snapshot.active.session} style={{display:"contents"}} inert={managerVisible||undefined} aria-hidden={managerVisible||undefined}>{children}</div>:null}
    {managerVisible?<LibraryManager controller={controller}/>:null}
  </LibraryContext.Provider>;
}
