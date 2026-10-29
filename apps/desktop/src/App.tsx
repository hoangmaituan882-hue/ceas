import {CollectionManager} from "@/components/CollectionManager";
import {AcquisitionStatus} from "@/components/AcquisitionStatus";
import {useAcquisition} from "@/data/use-acquisition";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Canvas } from "@ceas/views/canvas/canvas";
import "@ceas/views/canvas/canvas.css";
import { InfinityView } from "@ceas/views/infinity/infinity";
import "@ceas/views/infinity/infinity.css";
import type { ViewMode } from "@ceas/ui/view-switcher/view-switcher";
import { LibraryHeader } from "@/components/LibraryHeader";
import { QueryEmpty, QueryStatus } from "@/components/QueryStatus";
import { DetailOverlay, type Origin } from "@/components/DetailOverlay";
import { Grid } from "@/components/Grid";
import { GridModeSwitch } from "@/components/GridModeSwitch";
import { ZoomControl } from "@/components/ZoomControl";
import type { GridMode } from "@/components/Grid";
import { Sidebar } from "@/components/Sidebar";
import { Triage } from "@/components/Triage";
import { Toast } from "@/components/Toast";
import { ImportBar } from "@/components/ImportBar";
import { EmptyState } from "@/components/EmptyState";
import { BatchBar } from "@/components/BatchBar";
import { ContextMenu } from "@/components/ContextMenu";
import { Settings } from "@/components/Settings";
import { FileStatus } from "@/components/FileStatus";
import { FileIssues } from "@/components/FileIssues";
import { TrashPurge } from "@/components/TrashPurge";
import { SidebarMenu, type SidebarMenuState } from "@/components/SidebarMenu";
import { callStore, revealInExplorer } from "@/data/desktop";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { adoptMissing } from "@/data/file-coordinator";
import { readFileRecords } from "@ceas/core/file-reconcile";
import { TrashRestore } from "@/components/TrashRestore";
import { isDesktop, loadBlob, moveLibraryItem } from "@/data/desktop";
import { tagUsage } from "@/data/tags";
import { useLibraryData } from "@/data/use-library-data";
import { useLibraryFolders } from "@/data/use-library-folders";
import { useLibraryImports } from "@/data/use-library-imports";
import { inFolder, parentPath } from "@ceas/core/library-path";
import { LibraryOrganization } from "@/components/LibraryOrganization";
import { clearBoard, loadBoard, loadInfinityOffset, loadViewPrefs, mergeBoardPositions, saveBoard, saveInfinityOffset, saveViewPrefs, type BoardNode } from "@/data/board-store";
import { useItems } from "@/data/useItems";
import { useItemQuery } from "@/data/use-item-query";
import { useLibraryShortcuts } from "@/data/use-library-shortcuts";
import type { Item } from "@/data/items";
import { deleteItems, getOriginal,trackRepositoryWrite } from "@/data/db";
export type Density = "compact" | "standard" | "airy";
const DENSITY_ORDER: Density[] = ["compact", "standard", "airy"];

type UndoEntry = { id: string; index: number; previousPath?:string; deleted?:boolean };
const VIEWS: ViewMode[] = ["grid", "canvas", "infinity"];
const DENSITIES: Density[] = ["compact", "standard", "airy"];

export default function App() {
  /* 界面偏好与画布坐标从本地恢复：切视图、刷新都不应该丢 */
  const prefs = loadViewPrefs();
  const [view, setView] = useState<ViewMode>(VIEWS.includes(prefs.view as ViewMode) ? (prefs.view as ViewMode) : "grid");
  const [density, setDensity] = useState<Density>(DENSITIES.includes(prefs.density as Density) ? (prefs.density as Density) : "standard");
  const [collapsed, setCollapsed] = useState(prefs.collapsed === true);
  const [gridMode, setGridMode] = useState<GridMode>(prefs.grid === "masonry" ? "masonry" : "standard");
  const [zoom, setZoom] = useState<number>(typeof prefs.zoom === "number" ? prefs.zoom : 1);
  /* 坐标放 ref：画布卸载后重新挂载要能拿到最新值，
     但又不能用 state —— 用 state 会形成 setState ↔ 合并 的循环 */
  const boardRef = useRef<BoardNode[] | null>(loadBoard());
  const infinityRef = useRef(loadInfinityOffset());
  const [place, setPlace] = useState({ id: "all", label: "全部素材" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin | undefined>(undefined);

  const fixtureItems = useItems();
  const data = useLibraryData(fixtureItems);
  const {items,hasLibrary,tags,toggleItemTag,metadata:metaById,loadLibrary} = data;
  const fullUrl = useRef<string | null>(null);
  useEffect(() => () => { if(fullUrl.current) URL.revokeObjectURL(fullUrl.current); }, []);

  /* 收件箱：过片队列、撤销栈、标签、提示 */
  const [inbox, setInbox] = useState<string[]>([]);
  const [triage, setTriage] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [toast, setToast] = useState<{ text: string; undo?: boolean; deletedIds?: string[] } | null>(null);
  const [collectionsOpen,setCollectionsOpen]=useState(false);
  const imports=useLibraryImports(loadLibrary,data.reportError,(text)=>setToast({text}),collectionsOpen);
  const {imp,setImp,impPaused,setImpPaused,handle,importPixcall,startImport,dropFiles}=imports;
  const folderState=useLibraryFolders(items);
  const [organization,setOrganization]=useState<"folder"|"groups"|null>(null);
  const [triageBusy,setTriageBusy]=useState(false);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    saveViewPrefs({ density, view, collapsed, grid: gridMode, zoom });
  }, [density, view, collapsed, gridMode, zoom]);

  useEffect(() => {
    const pending=items.filter((item)=>item.kind!=="file"&&(!item.relativePath||!parentPath(item.relativePath))).map((item)=>item.id);
    setInbox(pending);setInboxTotal(pending.length);setCursor((value)=>Math.min(value,Math.max(0,pending.length-1)));
    if(!pending.length)setTriage(false);
  },[items]);

  /* Toast 4 秒自动消失 */
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const [fullSrc, setFullSrc] = useState<string | undefined>(undefined);

  /* 打开详情时按需取原图：列表阶段永远只碰 512 缩略图 */
  const showFull = (blob: Blob | null) => {
    if (!blob) return;
    if (fullUrl.current) URL.revokeObjectURL(fullUrl.current);
    fullUrl.current = URL.createObjectURL(blob);
    setFullSrc(fullUrl.current);
  };

  /* 原图加载：桌面端优先从磁盘（内容寻址），取不到再退 IndexedDB。
     这样正式版的库里只有一份原件。 */
  const loadFull = (id: string) => {
    const meta = metaById.current.get(id);
    if (!meta || meta.kind==="file") {
      setFullSrc(undefined);
      return;
    }
    void (async () => {
      if (isDesktop() && meta.ext) {
        const fromDisk = await loadBlob(meta.hash, meta.ext, data.repository.root, meta.relativePath,data.repository.session,id);
        if (fromDisk) {
          showFull(fromDisk);
          return;
        }
        return;
      }
      showFull(await getOriginal(meta.hash));
    })();
  };

  const open = (id: string, rect?: Origin) => {
    setOrigin(rect);
    setOpenId(id);
    setFullSrc(undefined);
    loadFull(id);
  };

  const select = (id: string, additive: boolean) => {
    setSelected((prev) => {
      if (!additive) return new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* Shift 连选与框选：一批 id 一次性合并进来 */
  const selectMany = (ids: string[], additive: boolean) => {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      for (const id of ids) next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  /* ── 标签：一份数据，网格右键与过片共用 ─────────────── */
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileIssuesOpen,setFileIssuesOpen]=useState(false),[restoreIds,setRestoreIds]=useState<string[]|null>(null);
  const [restoreDiskIds,setRestoreDiskIds]=useState<string[]>([]);
  const [sideMenu,setSideMenu]=useState<SidebarMenuState|null>(null);
  const [newFolderParent,setNewFolderParent]=useState<string|undefined>(undefined);
  const [collectionFocus,setCollectionFocus]=useState<string|undefined>(undefined);
  const [purge,setPurge]=useState<{ids:string[];all:boolean;bytes:number;diskOnly:number}|null>(null);
  const scopedItems=useMemo(()=>place.id.startsWith("collection:")?items.filter(item=>folderState.descendants.get(place.id)?.has(item.collectionId??"")):place.id.startsWith("folder:")?items.filter((item)=>inFolder(item.relativePath,place.id.slice(7)))
    :place.id.startsWith("tag:")?items.filter((item)=>(tags[item.id]??[]).includes(place.id.slice(4)))
    :place.id==="inbox"?items.filter((item)=>!item.relativePath||!parentPath(item.relativePath)):items,[items,tags,place.id,folderState.descendants]);
  useEffect(()=>{if(place.id.startsWith("collection:")){const row=folderState.rows.find(row=>`collection:${row.id}`===place.id);if(row&&place.label!==row.name)setPlace({id:place.id,label:row.name});else if(!row&&folderState.trash.some(row=>`collection:${row.id}`===place.id))setPlace({id:"all",label:"全部素材"});}},[folderState.rows,folderState.trash,place.id,place.label]);
  const query = useItemQuery(scopedItems, tags);
  const visibleItems = query.items;
  const acquisition=useAcquisition({place:place.id,filtered:query.hasConditions,collections:folderState.collections,busy:imports.importing,blocked:settingsOpen||organization!==null||collectionsOpen||fileIssuesOpen||restoreIds!==null||purge!==null||triage||openId!==null,notify:text=>setToast({text}),importPaths:imports.importPaths,importFiles:dropFiles});
  const canvasItems = useMemo(() => visibleItems.slice(0, 48), [visibleItems]);
  // 隐藏的选择仍可恢复，但当前批量操作只能作用于查询结果。
  const visibleSelected = useMemo(() => new Set([...selected].filter((id) => query.ids.has(id))), [selected, query.ids]);

  const deleteById = async (id: string) => {
    if(imports.importing){setToast({text:"正在导入，先停一下"});return;}
    if(imports.fileStatus.phase==="checking"||imports.fileStatus.phase==="processing"){setToast({text:"正在检查文件，稍后自动完成"});return;}
    try {
    await deleteItems([id]);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setCtx(null);
    await loadLibrary();
    setToast({ text: "已移入回收站 1 张", undo:true, deletedIds:[id] });
    } catch(error) { await loadLibrary().catch(()=>{});data.reportError(error); }
  };

  /* 「磁盘删除」= 原件已不在盘上（记录状态 missing）。它决定能不能还原、能释放多少空间。 */
  const diskDeleted = async (ids:string[]) => {
    const records = readFileRecords(await data.repository.records());
    return ids.filter((id)=>records[id]?.state==="missing");
  };

  /* 彻底删除：先确认，再执行，最后用后端返回的真实字节报账。 */
  const askPurge = async (ids:string[], all=false) => {
    if(imports.importing){setToast({text:"正在导入，先停一下"});return;}
    const disk = await diskDeleted(ids);
    const set = new Set(disk);
    const bytes = data.items.filter((item)=>ids.includes(item.id)&&!set.has(item.id)).reduce((sum,item)=>sum+(item.bytes??0),0);
    setPurge({ids,all,bytes,diskOnly:disk.length});
  };

  const doPurge = async () => {
    if(!purge)return;
    const result = purge.all ? await data.repository.emptyTrash() : await data.repository.purgeItems(purge.ids);
    setSelected(new Set());
    await loadLibrary();
    setToast({text:`已彻底删除 ${result.removed} 项${result.bytes>0?`，释放 ${(result.bytes/1024/1024).toFixed(1)} MB`:""}`});
  };

  /* 「磁盘删除」项的第三条出路：把整理信息合并到库里另一份素材。
     原件已经不存在，内容哈希不可能对上，所以不做"指认成这个文件"，
     只搬标签/描述/评分，然后清掉这条记录（08 §11.1 待补 2）。 */
  const mergeIntoItem = async (ids:string[]) => {
    const source = ids[0];
    if(!source) return;
    const picked = await openDialog({ directory:false, multiple:false, defaultPath:data.repository.root, title:"选择要合并到的素材" });
    if(typeof picked !== "string") return;
    const root = data.repository.root.replaceAll("\\","/");
    const relative = picked.replaceAll("\\","/").replace(`${root}/`,"");
    const target = data.items.find((item)=>item.relativePath?.toLowerCase()===relative.toLowerCase());
    if(!target) throw new Error("请选择资料库里已有的素材文件");
    if(target.id===source) throw new Error("不能合并到自己");
    const merged = await data.repository.mergeInto(source,target.id);
    await loadLibrary();
    setToast({text:`已合并到「${target.name}」${merged.tags?`，补上 ${merged.tags} 个标签`:""}`});
  };

  const removeSelected = async () => {
    if(imports.importing){setToast({text:"正在导入，先停一下"});return;}
    if(imports.fileStatus.phase==="checking"||imports.fileStatus.phase==="processing"){setToast({text:"正在检查文件，稍后自动完成"});return;}
    try {
    const ids = [...visibleSelected];
    if (ids.length === 0) return;
    await deleteItems(ids);
    setSelected((previous) => new Set([...previous].filter((id) => !query.ids.has(id))));
    await loadLibrary();
    setToast({ text: `已移入回收站 ${ids.length} 张`, undo:true, deletedIds:ids });
    } catch(error) { await loadLibrary().catch(()=>{});data.reportError(error); }
  };

  const restoreDeleted = async (ids:string[]) => {
    try {await data.repository.restoreItems(ids); await loadLibrary(); setToast({text:"已恢复删除的素材"});}
    catch(error){data.reportError(error);}
  };

  /* 侧栏与右键菜单共用同一套导航逻辑：两处各写一份必然走偏。 */
  const handlePick = (id:string, label:string) => {
    if(id==="inbox"&&imports.importing){setToast({text:"请等待导入结束或取消后再过片"});return;}
    if(id==="manage-collections"){if(imports.importing){setToast({text:"正在导入，先停一下"});return;}if(imports.fileStatus.phase==="checking"||imports.fileStatus.phase==="processing"){setToast({text:"正在检查文件，稍后自动完成"});return;}setCollectionsOpen(true);return;}
    if(id==="new"||id==="manage-tags"){setNewFolderParent(undefined);setOrganization(id==="new"?"folder":"groups");return;}
    setPlace({ id, label });setSelected(new Set());
    if((id==="trash")!==data.trashMode){data.setTrashMode(id==="trash");setSelected(new Set());query.clear();}
    if (id === "inbox") setTriage(true);
  };

  /* 右键菜单：只换高亮，不改当前视图（09「侧栏收藏集右键菜单」）。 */
  const contextMenu = (event:React.MouseEvent, collection:{id:string;label:string;path:string;depth:number;state?:string}) => {
    event.preventDefault();
    setSideMenu({ x:event.clientX, y:event.clientY, id:collection.id, label:collection.label, path:collection.path, depth:collection.depth, state:collection.state });
  };
  const bareId = (id:string) => id.replace(/^(collection|folder):/,"");

  const cycleDensity = () => {
    const i = DENSITY_ORDER.indexOf(density);
    setDensity(DENSITY_ORDER[(i + 1) % DENSITY_ORDER.length] ?? "standard");
  };

  /* ── 过片：归档 / 丢弃 / 标签 / 撤销 ─────────────────── */
  const currentId = inbox[cursor];
  const currentItem = currentId ? items.find((it) => it.id === currentId) : undefined;
  /* 胶片条需要整个队列，顺序与 inbox 一致，index 直接对应 */
  const queueItems = inbox
    .map((id) => items.find((it) => it.id === id))
    .filter((it): it is Item => !!it);

  const removeCurrent = (label: string, change:Pick<UndoEntry,"previousPath"|"deleted"> = {}) => {
    const id = inbox[cursor];
    if (!id) return;
    const item = items.find((it) => it.id === id);
    setUndoStack((s) => [...s.slice(-19), { id, index: cursor, ...change }]);
    const rest = inbox.filter((x) => x !== id);
    setInbox(rest);
    setCursor((c) => Math.min(c, Math.max(0, rest.length - 1)));
    if (rest.length === 0) {
      setTriage(false);
      setToast({ text: "收件箱已清空", undo: true });
    } else {
      setToast({ text: `${item?.name ?? id} ${label}`, undo: true });
    }
  };

  const moveTo=async(id:string,path:string)=>{
    if(isDesktop())await trackRepositoryWrite(moveLibraryItem(data.repository.root,id,path,data.repository.session));
    else {const row=metaById.current.get(id);if(!row)throw new Error("素材不存在");await data.repository.putItem({...row,relativePath:path,name:path.split("/").at(-1)??row.name});}
  };
  const archive=async(folder:string)=>{
    if(!currentId||triageBusy)return;const row=metaById.current.get(currentId);if(!row)return;
    setTriageBusy(true);try{await moveTo(currentId,`${folder}/${row.name}`);removeCurrent(`→ ${folder}`,{previousPath:row.relativePath??row.name});await loadLibrary();}
    catch(reason){data.reportError(reason);}finally{setTriageBusy(false);}
  };
  const discard=async()=>{
    if(!currentId||triageBusy)return;setTriageBusy(true);
    try{await deleteItems([currentId]);removeCurrent("已移入回收站",{deleted:true});await loadLibrary();}catch(reason){data.reportError(reason);}finally{setTriageBusy(false);}
  };
  const undo = async () => {
    const last=undoStack.at(-1);if(!last||triageBusy)return;setTriageBusy(true);
    try{if(last.deleted)await data.repository.restoreItems([last.id]);else if(last.previousPath)await moveTo(last.id,last.previousPath);
      await loadLibrary();setCursor(last.index);setUndoStack((stack)=>stack.slice(0,-1));setToast({text:"已撤销"});}
    catch(reason){data.reportError(reason);}finally{setTriageBusy(false);}
  };

  const addTag = (tag: string) => {
    if (!currentId) return;
    toggleItemTag(currentId, tag);
    setToast({ text: `已加标签「${tag}」`, undo: false });
  };

  const stepTriage = (dir: number) => {
    if (inbox.length === 0) return;
    setCursor((c) => (c + dir + inbox.length) % inbox.length);
  };

  /* 开发态探针：状态行正常时不渲染（零存在），验收脚本需要一个稳定的问法。 */
  useEffect(()=>{
    if(!import.meta.env.DEV)return;
    const probe=window as unknown as Record<string,unknown>;
    probe.__ceasImportPixcall=importPixcall;
    probe.__ceasCheckFiles=()=>imports.refreshDisk();
    probe.__ceasFilePhase=()=>imports.fileStatus.phase;
    probe.__ceasFileIssues=()=>imports.fileStatus.issues.length+imports.fileStatus.tasks.length;
    probe.__ceasOpenFileIssues=()=>setFileIssuesOpen(true);
  });

  useLibraryShortcuts({ triage, settingsOpen:settingsOpen||organization!==null||collectionsOpen||fileIssuesOpen||restoreIds!==null, openId, selected: visibleSelected,
    onView: setView, onToggleSidebar: () => setCollapsed((value) => !value), onOpen: open });

  const openIndex = openId ? visibleItems.findIndex((it) => it.id === openId) : -1;
  const openItem = openIndex >= 0 ? visibleItems[openIndex] : undefined;
  const step = (dir: number) => {
    if (openIndex < 0) return;
    const next = (openIndex + dir + visibleItems.length) % visibleItems.length;
    const target = visibleItems[next];
    if (target) {
      setOrigin(undefined);
      setOpenId(target.id);
      setFullSrc(undefined);
      loadFull(target.id);
    }
  };

  return (
    <div
      className="app" aria-busy={imports.importing}
      onDragOver={acquisition.onDragOver}
      onDrop={acquisition.onDrop}
      onDragLeave={acquisition.onDragLeave}
    >
      <Sidebar
        collapsed={collapsed}
        canManageCollections={isDesktop()}
        activeId={place.id}
        inboxCount={inbox.length}
        counts={folderState.counts}
        collections={folderState.collections}
        tagGroups={folderState.tagGroups}
        tags={tagUsage(tags).slice(0, 6).map((t) => t.tag)}
        onPick={handlePick}
        onContext={contextMenu}
        contextId={sideMenu?.id ?? null}
        dropTargetId={acquisition.hoverId}
        onImport={startImport}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="main">
        <LibraryHeader label={place.label} view={view} density={density} query={query}
          onToggleSidebar={() => setCollapsed((value) => !value)}
          onLibrary={() => {setPlace({ id: "all", label: "全部素材" });data.setTrashMode(false);setSelected(new Set());}}
          onView={setView} onDensity={cycleDensity} />
        <QueryStatus query={query} />
        <AcquisitionStatus target={acquisition.feedback}/>
        {data.trashMode&&isDesktop()?<div className="query-summary">
          <button className="query-action" disabled={imports.importing} onClick={()=>setCollectionsOpen(true)}>收藏集回收站 · {folderState.trash.length}</button>
          {items.length>0?<button className="query-action" disabled={imports.importing} onClick={()=>{void askPurge(items.map((item)=>item.id),true);}}>清空回收站</button>:null}
        </div>:null}
        {isDesktop()?<FileStatus status={imports.fileStatus} busy={imports.importing} onOpen={()=>setFileIssuesOpen(true)} onCheck={imports.refreshDisk}/>:null}
        {data.error ? <div className="query-summary" role="alert"><span>资料库操作失败：{data.error}</span><button type="button" className="query-action" onClick={() => void loadLibrary().catch(data.reportError)}>重试</button></div> : null}

        <main className="content">
          {data.trashMode && items.length===0 ? <div className="empty"><p className="empty-title">{folderState.trash.length?`已回收 ${folderState.trash.length} 个收藏集`:"回收站为空"}</p>{folderState.trash.length?<button className="query-action" disabled={imports.importing} onClick={()=>setCollectionsOpen(true)}>查看已回收收藏集</button>:null}</div> : hasLibrary && items.length === 0 ? (
            <EmptyState onImport={startImport} />
          ) : query.hasConditions && visibleItems.length === 0 ? (
            <QueryEmpty onClear={query.clear} />
          ) : view === "grid" ? (
            <Grid
              items={visibleItems}
              selected={selected}
              density={density}
              mode={gridMode}
              zoom={zoom}
              recede={openId !== null}
              focusId={openId}
              onSelect={select}
              onSelectMany={selectMany}
              onClear={clearSelection}
              onOpen={open}
              onContext={(id, x, y) => {
                if(data.trashMode)return;
                /* 右键落在没选中的项上：先把它变成当前选中，符合系统习惯 */
                if (!selected.has(id)) setSelected(new Set([id]));
                setCtx({ id, x, y });
              }}
            />
          ) : view === "canvas" ? (
            <Canvas
              items={canvasItems}
              board={boardRef.current}
              onBoardChange={(nodes) => {
                if(data.trashMode)return;
                const retainedIds=new Set([...items.map((item)=>item.id),...(boardRef.current??[]).map((node)=>node.id)]);
                boardRef.current = mergeBoardPositions(boardRef.current, nodes, retainedIds);
                saveBoard(boardRef.current);
              }}
              onReset={clearBoard}
              selected={selected}
              onSelect={select}
              onClear={clearSelection}
              onOpen={open}
            />
          ) : (
            <InfinityView
              items={visibleItems}
              offset={infinityRef.current}
              onOffsetChange={(o) => {
                infinityRef.current = o;
                saveInfinityOffset(o);
              }}
              selected={selected}
              onSelect={select}
              onClear={clearSelection}
              onOpen={open}
            />
          )}
        </main>
      </div>

      <AnimatePresence>
        {openItem ? (
          <DetailOverlay
            key="detail"
            item={openItem}
            index={openIndex}
            total={visibleItems.length}
            origin={origin}
            fullSrc={fullSrc}
            tags={tags[openItem.id]??[]}
            onSimilarColor={(color)=>{query.setFilter("similarColor",color);setOpenId(null);setFullSrc(undefined);}}
            onSaveMetadata={data.trashMode?undefined:async(patch)=>{const row=metaById.current.get(openItem.id);if(!row)throw new Error("素材不存在");
              let site=row.site;try{site=patch.sourceUrl?new URL(patch.sourceUrl).hostname:undefined;}catch{throw new Error("来源网址格式不正确");}
              await data.repository.patchMetadata(row.id,{...patch,site});await loadLibrary();}}
            onClose={() => {
              setOpenId(null);
              setFullSrc(undefined);
            }}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {triage && currentItem ? (
          <Triage
            key="triage"
            item={currentItem}
            queue={queueItems}
            index={cursor}
            onJump={(i) => setCursor(i)}
            remaining={inbox.length}
            total={inboxTotal}
            collections={folderState.collections}
            canUndo={undoStack.length > 0}
            onNext={() => stepTriage(1)}
            onPrev={() => stepTriage(-1)}
            busy={triageBusy}
            onArchive={(id) => {const folder=folderState.collections.find((entry)=>entry.id===id);if(folder)void archive(folder.path);}}
            onDiscard={() => void discard()}
            onTag={addTag}
            onUndo={undo}
            onExit={() => setTriage(false)}
          />
        ) : null}
      </AnimatePresence>

      {organization?<LibraryOrganization mode={organization} initialName={newFolderParent?`${newFolderParent}/`:undefined} onClose={()=>{setOrganization(null);setNewFolderParent(undefined);}}/>:null}

      {settingsOpen ? (
        <Settings onClose={() => setSettingsOpen(false)} onImportPixcall={importPixcall} importing={imports.importing} onRefreshDisk={imports.refreshDisk} onLibraryUpdated={loadLibrary} fileStatus={{phase:imports.fileStatus.phase,checkedAt:imports.fileStatus.checkedAt,issues:imports.fileStatus.issues.length+imports.fileStatus.tasks.length,mode:imports.fileStatus.mode}}/>
      ) : null}

      {ctx && query.ids.has(ctx.id) ? (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          applied={tags[ctx.id] ?? []}
          frequent={tagUsage(tags).slice(0, 6)}
          onOpenItem={() => {
            const id = ctx.id;
            setCtx(null);
            /* 拿到那一格的矩形，打开时才有同元素位移 */
            const el = document.querySelector<HTMLElement>(`.cell[data-id="${id}"]`);
            const r = el?.getBoundingClientRect();
            open(id, r ? { x: r.x, y: r.y, w: r.width, h: r.height } : undefined);
          }}
          onToggleTag={(t) => toggleItemTag(ctx.id, t)}
          onAddTag={(t) => toggleItemTag(ctx.id, t)}
          onDelete={() => void deleteById(ctx.id)}
          onClose={() => setCtx(null)}
        />
      ) : null}

      {view === "grid" && visibleItems.length > 0 && !triage ? (
        <div className="grid-tools">
          <ZoomControl value={zoom} onChange={setZoom} />
          <span className="grid-tools-sep" aria-hidden="true" />
          <GridModeSwitch value={gridMode} onChange={setGridMode} />
        </div>
      ) : null}

      <AnimatePresence>
        {!triage&&visibleSelected.size >= (data.trashMode?1:2) ? (
          <BatchBar key={data.trashMode?"restore":"batch"} count={visibleSelected.size} onDelete={removeSelected} onCancel={clearSelection} onPurge={data.trashMode?()=>{void askPurge([...visibleSelected]);}:undefined}
            onRestore={data.trashMode?()=>{if(isDesktop()){const picked=[...visibleSelected];void diskDeleted(picked).then((disk)=>{setRestoreDiskIds(disk);setRestoreIds(picked);});}else void restoreDeleted([...visibleSelected]);}:undefined} />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>{collectionsOpen?<CollectionManager root={data.repository.root} session={data.repository.session} initialTrash={data.trashMode} focusId={collectionFocus} onClose={()=>{setCollectionsOpen(false);setCollectionFocus(undefined);}} onUpdated={loadLibrary} onOpen={(id,label)=>{setPlace({id:`collection:${id}`,label});setCollectionsOpen(false);}}/>:null}</AnimatePresence>
      {fileIssuesOpen?<FileIssues status={imports.fileStatus} busy={imports.importing} onClose={()=>setFileIssuesOpen(false)} onCheck={imports.refreshDisk} onAssociate={imports.associate} onResolve={imports.resolveAmbiguity} onKeep={imports.keepIndependent} onRetryTasks={imports.retryTasks} onCancelTask={imports.cancelTask} onRetargetTask={imports.retargetTask} onAdoptMissing={async(ids)=>{await adoptMissing(data.repository,ids);await loadLibrary();await imports.refreshDisk();}} onAcceptContent={imports.acceptContent} onRelocate={imports.relocateCollection}
        onRetryImport={imports.retryAcquisition} onIgnore={async(id)=>{await callStore(data.repository.root,{action:"ignore_file",id,ignore:true},data.repository.session);await imports.refreshDisk();}}/>:null}
      {restoreIds?<TrashRestore ids={restoreIds} root={data.repository.root} session={data.repository.session} diskIds={restoreDiskIds} onClose={()=>{setRestoreIds(null);setRestoreDiskIds([]);}} onRestore={async(folder)=>{await data.repository.restoreItems(restoreIds.filter((id)=>!restoreDiskIds.includes(id)),folder);await loadLibrary();setSelected(new Set());setToast({text:"已恢复原件，同名文件保留双方"});}} onPurge={async(ids)=>{await data.repository.purgeItems(ids);}} onMerge={mergeIntoItem}/>:null}
      {sideMenu?<SidebarMenu menu={sideMenu} desktop={isDesktop()} blocked={imports.importing||imports.fileStatus.phase==="checking"||imports.fileStatus.phase==="processing"} onClose={()=>setSideMenu(null)}
        onOpen={()=>handlePick(sideMenu.id,sideMenu.label)}
        onReveal={()=>{void revealInExplorer(`${data.repository.root}/${sideMenu.path}`).catch((reason)=>data.reportError(reason));}}
        onNewChild={()=>{setNewFolderParent(sideMenu.path);setOrganization("folder");}}
        onRename={()=>{setCollectionFocus(bareId(sideMenu.id));setCollectionsOpen(true);}}
        onCopyPath={()=>{void navigator.clipboard.writeText(`${data.repository.root}/${sideMenu.path}`).then(()=>setToast({text:"已复制路径"}),(reason)=>data.reportError(reason));}}
        onTrash={()=>{setCollectionFocus(bareId(sideMenu.id));setCollectionsOpen(true);}}
      />:null}
      {purge?<TrashPurge count={purge.ids.length} all={purge.all} bytes={purge.bytes} diskOnly={purge.diskOnly} onConfirm={doPurge} onClose={()=>setPurge(null)}/>:null}

      <AnimatePresence>
        {imp&&!triage ? (
          <ImportBar
            key="import"
            progress={imp}
            paused={impPaused}
            onPause={() => {
              handle.current?.pause();
              setImpPaused(true);
            }}
            onResume={() => {
              handle.current?.resume();
              setImpPaused(false);
            }}
            onCancel={() => {
              handle.current?.cancel();
              setToast({text:"正在取消，已导入的文件会保留"});
            }}
            onClose={() => setImp(null)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {toast ? (
          <Toast key={toast.text} text={toast.text} raised={triage} onUndo={toast.deletedIds ? () => void restoreDeleted(toast.deletedIds ?? []) : toast.undo ? undo : undefined} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
