import { Folder, Inbox, Plus, Settings, Tag, TrashCan } from "@ceas/ui/icons";
import type { Collection } from "@/data/collections";
import type { TagGroup } from "@/data/desktop";
import type { CSSProperties } from "react";

/* ══ 侧栏 ════════════════════════════════════════════════════
   三段：收件箱 / 收藏集 / 标签，底部是导入与设置。

   计数与标签都来自真实数据（counts、tags 由 App 传入）；
   没有数据时不渲染数字与空分组 —— 宁可少一行，也不摆假数字。
   ------------------------------------------------------------ */

type Props = {
  collapsed: boolean;
  canManageCollections?:boolean;
  activeId: string;
  inboxCount: number;
  counts: Record<string, number>;
  collections: Collection[];
  tagGroups: TagGroup[];
  /** 全库最常用的标签，用来组成「标签」分组 */
  tags: string[];
  onPick: (id: string, label: string) => void;
  onImport: () => void;
  onSettings: () => void;
  /** 右键收藏集：只对收藏集行生效，其它行不拦截 */
  onContext?: (event: React.MouseEvent, collection: Collection) => void;
  /** 菜单正在操作的那一行（弱于选中，只是上下文提示） */
  contextId?: string | null;
  dropTargetId?:string;
};

export function Sidebar({ collapsed,canManageCollections, activeId, inboxCount, counts, collections, tagGroups, tags, onPick, onImport, onSettings, onContext, contextId,dropTargetId }: Props) {
  return (
    <aside className="rail" data-collapsed={collapsed || undefined}>
      <div className="rail-tree">
      <div className="rail-section">
        <span>收件箱</span>
      </div>
      <button
        type="button"
        className="rail-item"
        data-depth="0"
        data-active={activeId === "inbox" || undefined}
        onClick={() => onPick("inbox", "收件箱")}
      >
        <Inbox size={16} />
        收件箱
        {inboxCount > 0 ? <span className="count">{inboxCount}</span> : null}
      </button>

      <div className="rail-section">
        <span>收藏集</span>
      </div>
      {collections.map((c) => (
        <button
          key={c.id}
          type="button"
          className="rail-item"
          data-depth={c.depth}
          data-folder="true"
          data-acquisition-folder={c.id}
          data-drop-target={dropTargetId===c.id||undefined}
          style={{"--folder-level":c.depth} as CSSProperties}
          title={c.path}
          data-active={activeId === c.id || undefined}
          data-context={contextId === c.id || undefined}
          onClick={() => onPick(c.id, c.label)}
          onContextMenu={(event) => onContext?.(event, c)}
        >
          <Folder size={16} />
          <span className="folder-name">{c.label}</span>
          {counts[c.id] ? <span className="count">{counts[c.id]}</span> : null}
        </button>
      ))}
      <button type="button" className="rail-item" data-depth="1" onClick={() => onPick("new", "新建收藏集")}>
        <Plus size={16} />
        新建收藏集
      </button>

      {canManageCollections?<button type="button" className="rail-item" data-depth="1" onClick={()=>onPick("manage-collections","管理收藏集")}><Folder className="query-icon"/>管理收藏集</button>:null}

      {tagGroups.map((group)=><div key={group.id}>
        <div className="rail-section"><span className="tag-group-color" style={{color:group.color??undefined}}>{group.name}</span></div>
        {group.tags.map((tag)=><button type="button" className="rail-item" data-depth="1" key={tag} data-active={activeId===`tag:${tag}`||undefined} onClick={()=>onPick(`tag:${tag}`,`#${tag}`)}><Tag className="query-icon"/>{tag}</button>)}
      </div>)}
      <button type="button" className="rail-item" data-depth="1" onClick={()=>onPick("manage-tags","管理标签组")}><Tag className="query-icon"/>管理标签组</button>

      {tags.length > 0 ? (
        <>
          <div className="rail-section">
            <span>标签</span>
          </div>
          {tags.filter((tag)=>!tagGroups.some((group)=>group.tags.includes(tag))).map((t) => (
            <button
              key={t}
              type="button"
              className="rail-item"
              data-depth="1"
              data-active={activeId === `tag:${t}` || undefined}
              onClick={() => onPick(`tag:${t}`, `#${t}`)}
            >
              <Tag size={16} />
              {t}
              <span className="dot" />
            </button>
          ))}
        </>
      ) : null}

      </div>
      <button type="button" className="rail-item" data-depth="0" data-active={activeId==="trash"||undefined} onClick={()=>onPick("trash","回收站")}>
        <TrashCan className="query-icon"/>回收站
      </button>

      <button type="button" className="rail-item" data-depth="0" onClick={onImport}>
        <Plus size={16} />
        导入素材
      </button>

      <button type="button" className="rail-item" data-depth="0" onClick={onSettings}>
        <Settings size={16} />
        设置
      </button>
    </aside>
  );
}
