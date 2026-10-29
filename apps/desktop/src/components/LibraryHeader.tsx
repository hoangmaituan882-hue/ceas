import { Density as DensityIcon, Menu,ChevronRight } from "@ceas/ui/icons";
import { ViewSwitcher, type ViewMode } from "@ceas/ui/view-switcher/view-switcher";
import "@ceas/ui/view-switcher/view-switcher.css";
import type { Density } from "@/App";
import type { ItemQuery } from "@/data/use-item-query";
import { LibraryTools } from "./LibraryTools";
import { useLibraryContext } from "@/data/library-context";

const DENSITY_LABEL = { compact: "紧凑", standard: "标准", airy: "宽松" };
type Props = {
  label: string; view: ViewMode; density: Density; query: ItemQuery;
  onToggleSidebar: () => void; onLibrary: () => void;
  onView: (view: ViewMode) => void; onDensity: () => void;
};

export function LibraryHeader({ label, view, density, query, onToggleSidebar, onLibrary, onView, onDensity }: Props) {
  const manager=useLibraryContext();
  return (
    <header className="topbar">
      <button type="button" className="menu-btn" onClick={onToggleSidebar} aria-label="折叠侧栏（Ctrl+B）"><Menu size={18} /></button>
      <nav className="crumbs" aria-label="位置">
        <button type="button" className={manager?"library-header-name":undefined} title={manager?.active?.path} onClick={onLibrary}>{manager?.active?.name??"资料库"}</button>
        {manager?<button type="button" className="library-header-manage" aria-label="管理资料库" onClick={()=>manager.open()}><ChevronRight/></button>:null}
        <span className="sep">/</span><span className="here">{label}</span>
        <span className="sep">·</span><span className="count">{query.hasConditions ? `${query.items.length} / ${query.total}` : query.total}</span>
      </nav>
      <div className="capsule-slot"><ViewSwitcher value={view} onChange={onView} /></div>
      <div className="tools"><div className="mini-capsule">
        <button type="button" className="icon-btn" onClick={onDensity}
          title={`密度：${DENSITY_LABEL[density]}（点击切换）`} aria-label={`密度：${DENSITY_LABEL[density]}，点击切换`}>
          <DensityIcon className="query-icon" />
        </button>
        <LibraryTools query={query} />
      </div></div>
    </header>
  );
}
