import { SORT_LABELS } from "@ceas/core/item-query";
import type { ItemQuery } from "@/data/use-item-query";

export function QueryStatus({ query }: { query: ItemQuery }) {
  if (!query.hasConditions && query.sort === "created-asc") return null;
  return (
    <div className="query-summary">
      <span role="status" aria-live="polite">显示 {query.items.length} / {query.total} 项</span>
      {query.text.trim() ? <span className="query-term">搜索：{query.text.trim()}</span> : null}
      {query.filterCount > 0 ? <span>{query.filterCount} 个筛选条件</span> : null}
      <span>{SORT_LABELS[query.sort]}</span>
      {query.hasConditions ? <button type="button" className="query-action" onClick={query.clear}>清除搜索与筛选</button> : null}
    </div>
  );
}

export function QueryEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="query-empty" role="status">
      <p>没有匹配的素材</p>
      <p className="query-help">试试其他关键词，或清除搜索与筛选。</p>
      <button type="button" className="query-action" onClick={onClear}>清除条件</button>
    </div>
  );
}
