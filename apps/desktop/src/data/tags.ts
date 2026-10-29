/* ══ 标签 ════════════════════════════════════════════════════
   一个素材可以有多个标签；标签本身没有独立实体，就是字符串，
   频次由「有多少素材带它」聚合出来 —— 这样「常用标签」永远
   反映真实使用情况，不需要单独维护计数器。
   ------------------------------------------------------------ */

export type TagMap = Record<string, string[]>;

const KEY = "ceas.tags.v1";

export function loadTags(): TagMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: TagMap = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) out[id] = v.filter((t): t is string => typeof t === "string");
    }
    return out;
  } catch {
    return {};
  }
}

export function saveTags(map: TagMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 配额满或隐私模式：界面照常，只是不持久 */
  }
}

/** 切换某个素材上的某个标签 */
export function toggleTag(map: TagMap, itemId: string, tag: string): TagMap {
  const t = tag.trim();
  if (!t) return map;
  const current = map[itemId] ?? [];
  const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
  const out = { ...map };
  if (next.length === 0) delete out[itemId];
  else out[itemId] = next;
  return out;
}

/** 标签 → 出现次数，按次数降序、同次数按字典序 */
export function tagUsage(map: TagMap): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const list of Object.values(map)) {
    for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function topTags(map: TagMap, limit = 6): string[] {
  return tagUsage(map).slice(0, limit).map((t) => t.tag);
}
