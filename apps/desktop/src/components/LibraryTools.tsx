import { useEffect, useId, useRef, useState } from "react";
import { Filter, Search, Sort } from "@ceas/ui/icons";
import { isSortOrder, SORT_LABELS } from "@ceas/core/item-query";
import type { ItemQuery } from "@/data/use-item-query";
import { QueryFilters } from "./QueryFilters";
import "./library-tools.css";

type Panel = "search" | "sort" | "filter";
const PANEL_LABELS: Record<Panel, string> = { search: "搜索素材", sort: "排序方式", filter: "筛选素材" };

export function LibraryTools({ query }: { query: ItemQuery }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLElement>(null);
  const triggers = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({});
  const id = useId();

  const close = () => {
    if (panel) triggers.current[panel]?.focus();
    setPanel(null);
  };

  useEffect(() => {
    if (panel) (body.current?.querySelector<HTMLElement>("input, select") ?? body.current?.querySelector("button"))?.focus();
  }, [panel]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.isComposing) {
        // 详情、设置、过片拥有自己的键位，不能在模态背后打开搜索。
        if (document.querySelector('[aria-modal="true"]')) return;
        event.preventDefault();
        setPanel("search");
        body.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      }
      if (event.key === "Escape" && panel) {
        event.preventDefault();
        event.stopImmediatePropagation();
        triggers.current[panel]?.focus();
        setPanel(null);
      }
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setPanel(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("focusin", dismiss);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("focusin", dismiss);
    };
  }, [panel]);

  return (
    <div className="library-tools" ref={root}>
      {(["sort", "filter", "search"] as const).map((kind) => {
        const Icon = kind === "sort" ? Sort : kind === "filter" ? Filter : Search;
        const active = kind === "sort" ? query.sort !== "created-asc"
          : kind === "filter" ? query.filterCount > 0 : query.text.trim().length > 0;
        const label = kind === "sort" ? "排序" : kind === "filter" ? "筛选" : "搜索";
        return (
          <button key={kind} type="button" className="icon-btn"
            ref={(button) => { triggers.current[kind] = button; }}
            data-active={active || panel === kind || undefined}
            aria-label={label} title={kind === "search" ? "搜索（Ctrl+K）" : label}
            aria-expanded={panel === kind} aria-haspopup="dialog"
            aria-controls={panel === kind ? `${id}-panel` : undefined}
            onClick={() => setPanel((previous) => previous === kind ? null : kind)}>
            <Icon className="query-icon" />
          </button>
        );
      })}
      {panel ? (
        <section className="query-panel" role="dialog" aria-label={PANEL_LABELS[panel]} id={`${id}-panel`} ref={body}>
          <div className="query-panel-head">
            <strong>{PANEL_LABELS[panel]}</strong>
            <button type="button" className="query-action" onClick={close} aria-label={`关闭${PANEL_LABELS[panel]}`}>关闭</button>
          </div>
          {panel === "search" ? (
            <label className="query-field">
              <span>文件名、目录、描述、来源、标签或色名</span>
              <input type="search" aria-label="搜索素材" placeholder="输入关键词，空格分隔多个条件" value={query.text}
                onChange={(event) => query.setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) close();
                }} />
            </label>
          ) : panel === "sort" ? (
            <label className="query-field">
              <span>排序方式</span>
              <select aria-label="排序方式" value={query.sort} onChange={(event) => {
                if (isSortOrder(event.target.value)) query.setSort(event.target.value);
              }}>
                {Object.entries(SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <span className="query-help">未知时间或大小排在最后；画布已有坐标保持原位。</span>
            </label>
          ) : <QueryFilters query={query} />}
          <p className="query-result" role="status" aria-live="polite">找到 {query.items.length} / {query.total} 项</p>
        </section>
      ) : null}
    </div>
  );
}
