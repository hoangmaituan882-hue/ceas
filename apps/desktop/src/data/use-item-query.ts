import { useMemo, useState } from "react";
import {
  countFilters, createItemIndex, DEFAULT_FILTERS, isSortOrder, selectItems,
  type DateBounds, type ItemFilters, type SortOrder,
} from "@ceas/core/item-query";
import type { Item } from "./items";
import type { TagMap } from "./tags";

const SORT_KEY = "ceas.sort.v1";
function loadSort(): SortOrder {
  try {
    const stored = localStorage.getItem(SORT_KEY);
    return isSortOrder(stored) ? stored : "created-asc";
  } catch { return "created-asc"; }
}

/** 日期输入按本地日界换算，保存的时间戳仍为 UTC 毫秒；结束日包含整天。 */
function resolveDates(from: string, to: string): DateBounds {
  const boundary = (value: string, nextDay: boolean): number | undefined => {
    if (!value) return undefined;
    const parts = value.split("-").map(Number);
    const [year, month, day] = parts;
    if (!year || !month || !day) return Number.NaN;
    return new Date(year, month - 1, day + (nextDay ? 1 : 0)).getTime();
  };
  const start = boundary(from, false);
  const until = boundary(to, true);
  return {
    from: start, until,
    invalid: (start !== undefined && !Number.isFinite(start))
      || (until !== undefined && !Number.isFinite(until)) || Boolean(from && to && from > to),
  };
}

export function useItemQuery(items: readonly Item[], tags: TagMap) {
  const [text, setText] = useState("");
  const [sort, updateSort] = useState<SortOrder>(loadSort);
  const [filters, setFilters] = useState<ItemFilters>(DEFAULT_FILTERS);
  const index = useMemo(() => createItemIndex(items, tags), [items, tags]);
  const dates = useMemo(() => resolveDates(filters.dateFrom, filters.dateTo), [filters.dateFrom, filters.dateTo]);
  const results = useMemo(() => selectItems(index, text, filters, sort, dates), [index, text, filters, sort, dates]);
  const ids = useMemo(() => new Set(results.map((item) => item.id)), [results]);
  const availableTags = useMemo(() => [...new Set(Object.values(tags).flat())].sort((a, b) => a.localeCompare(b, "zh-CN")), [tags]);
  const sites = useMemo(() => [...new Set(items.flatMap((item) => item.site ? [item.site] : []))].sort(), [items]);

  const setSort = (value: SortOrder) => {
    updateSort(value);
    try { localStorage.setItem(SORT_KEY, value); } catch { /* 偏好写入失败不影响检索。 */ }
  };
  const setFilter = <K extends keyof ItemFilters>(key: K, value: ItemFilters[K]) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
  };
  const resetFilters = () => setFilters(DEFAULT_FILTERS);
  const clear = () => { setText(""); resetFilters(); };
  const filterCount = countFilters(filters);

  return {
    items: results, ids, text, setText, sort, setSort, filters, setFilter,
    resetFilters, clear, filterCount, availableTags, sites, total: items.length,
    hasConditions: text.trim().length > 0 || filterCount > 0,
    dateError: dates.invalid ? "开始日期不能晚于结束日期，请检查日期范围。" : "",
  };
}

export type ItemQuery = ReturnType<typeof useItemQuery>;
