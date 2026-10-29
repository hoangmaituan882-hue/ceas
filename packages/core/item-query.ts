import { parseColor, toLab, type Rgb } from "./color-index.ts";
/** 查询保持纯函数，三个视图只消费同一份结果，不各自维护筛选逻辑。 */
export type QueryableItem = {
  id: string;
  name: string;
  originalName?: string;
  kind: "image" | "video" | "link" | "file";
  aspect: number;
  color: string;
  site?: string;
  createdAt?: number;
  bytes?: number;
  durationSeconds?: number;
  relativePath?: string;
  description?: string;
  sourceUrl?: string;
  rating?: number;
  palette?: readonly string[];
};

export const SORT_LABELS = {
  "created-asc": "最早导入优先",
  "created-desc": "最近导入优先",
  "name-asc": "文件名 A → Z",
  "name-desc": "文件名 Z → A",
  "size-desc": "文件大小：大到小",
  "size-asc": "文件大小：小到大",
  "aspect-desc": "宽高比：宽到窄",
  "aspect-asc": "宽高比：窄到宽",
} as const;
export type SortOrder = keyof typeof SORT_LABELS;
export const isSortOrder = (value: unknown): value is SortOrder =>
  typeof value === "string" && Object.hasOwn(SORT_LABELS, value);

export const COLOR_LABELS = {
  neutral: "中性色", red: "红色", orange: "橙色", yellow: "黄色",
  green: "绿色", cyan: "青色", blue: "蓝色", purple: "紫色", pink: "粉色",
} as const;
type ColorFamily = keyof typeof COLOR_LABELS;
export type ItemFilters = {
  kind: "all" | QueryableItem["kind"];
  aspect: "all" | "landscape" | "portrait" | "square";
  tag: string;
  site: string;
  color: "all" | ColorFamily;
  lightness: "all" | "dark" | "medium" | "light";
  saturation: "all" | "muted" | "vivid";
  duration: "all" | "short" | "medium" | "long";
  dateFrom: string;
  dateTo: string;
  rating: "all" | "unrated" | "1" | "2" | "3" | "4" | "5";
  similarColor: string;
};
export const DEFAULT_FILTERS: Readonly<ItemFilters> = Object.freeze({
  kind: "all", aspect: "all", tag: "", site: "", color: "all",
  lightness: "all", saturation: "all", duration: "all", dateFrom: "", dateTo: "", rating: "all", similarColor: "",
});
export function countFilters(filters: ItemFilters): number {
  return (Object.keys(DEFAULT_FILTERS) as (keyof ItemFilters)[])
    .filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;
}

const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase("zh-CN");

/** 中文连续片段切 bigram，多词采用 AND；单个汉字仍可检索。 */
export function searchTokens(text: string): string[] {
  const parts = normalize(text).match(/\p{Script=Han}+|[\p{L}\p{N}]+/gu) ?? [];
  return parts.flatMap((part) => {
    const chars = [...part];
    if (!/^\p{Script=Han}+$/u.test(part) || chars.length < 2) return [part];
    return chars.slice(1).map((char, index) => `${chars[index]}${char}`);
  });
}

type Tone = { family: ColorFamily; lightness: number; saturation: number };

/** 现有主色为 sRGB 平均色；用 HSL 粗分色族，不将其冒充感知色距。 */
function readTone(color: string): Tone | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(color);
  let channels: number[];
  if (hex?.[1]) {
    const expanded = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255);
  } else if (rgb) {
    channels = rgb.slice(1).map((value) => Math.min(255, Number(value)) / 255);
  } else return null;
  const [r = 0, g = 0, b = 0] = channels;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const family: ColorFamily = saturation < 0.15 ? "neutral"
    : hue < 15 || hue >= 345 ? "red" : hue < 45 ? "orange"
    : hue < 70 ? "yellow" : hue < 165 ? "green" : hue < 195 ? "cyan"
    : hue < 255 ? "blue" : hue < 290 ? "purple" : "pink";
  return { family, lightness, saturation };
}

export type IndexedItem<T extends QueryableItem> = {
  item: T;
  tags: readonly string[];
  text: string;
  tone: Tone | null;
  tones: Tone[];
  labColors: Rgb[];
  index: number;
};
export function createItemIndex<T extends QueryableItem>(
  items: readonly T[], tags: Readonly<Record<string, readonly string[]>>,
): IndexedItem<T>[] {
  return items.map((item, index) => {
    const itemTags = tags[item.id] ?? [];
    const tone = readTone(item.color);
    const tones = (item.palette?.length ? item.palette : [item.color]).map(readTone).filter((value): value is Tone => value !== null);
    return {
      item, index, tags: itemTags, tone, tones,
      labColors:(item.palette?.length?item.palette:[item.color]).map(parseColor).filter((color):color is Rgb=>color!==null).map(toLab),
      text: normalize([item.name, item.originalName ?? "", item.site ?? "", item.relativePath??"",item.description??"",item.sourceUrl??"", ...itemTags,
        ...tones.map((tone)=>COLOR_LABELS[tone.family])].join(" ")),
    };
  });
}

export type DateBounds = { from?: number; until?: number; invalid?: boolean };
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function selectItems<T extends QueryableItem>(
  index: readonly IndexedItem<T>[], text: string, filters: ItemFilters,
  sort: SortOrder, dates: DateBounds = {},
): T[] {
  if (dates.invalid) return [];
  const tokens = searchTokens(text);
  const targetColor=filters.similarColor?parseColor(filters.similarColor):null;
  const targetLab=targetColor?toLab(targetColor):null;
  const rows = index.filter((entry) => {
    const { item, tone, tags } = entry;
    if (!tokens.every((token) => entry.text.includes(token))) return false;
    if (filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.tag && !tags.includes(filters.tag)) return false;
    if (filters.site && item.site !== filters.site) return false;
    if(filters.aspect!=="all"&&item.kind==="file")return false;
    if(filters.similarColor&&(!targetLab||item.kind!=="image"||!entry.labColors.some((sample)=>Math.hypot(sample[0]-targetLab[0],sample[1]-targetLab[1],sample[2]-targetLab[2])<=20)))return false;
    if (filters.aspect === "square" && !(item.aspect >= 0.95 && item.aspect <= 1.05)) return false;
    if (filters.aspect === "landscape" && !(item.aspect > 1.05)) return false;
    if (filters.aspect === "portrait" && !(item.aspect < 0.95)) return false;
    if (filters.rating === "unrated" && (item.rating??0) !== 0) return false;
    if (filters.rating && filters.rating !== "all" && filters.rating !== "unrated" && (item.rating??0) < Number(filters.rating)) return false;
    if (filters.color !== "all" && !entry.tones.some((candidate)=>candidate.family===filters.color
      && (filters.lightness==="all" || (candidate.lightness<1/3?"dark":candidate.lightness<2/3?"medium":"light")===filters.lightness)
      && (filters.saturation==="all" || (candidate.saturation<0.35?"muted":"vivid")===filters.saturation))) return false;
    if (filters.color === "all" && filters.lightness !== "all") {
      if (!tone) return false;
      const lightness = tone.lightness < 1 / 3 ? "dark" : tone.lightness < 2 / 3 ? "medium" : "light";
      if (filters.lightness !== lightness) return false;
    }
    if (filters.color === "all" && filters.saturation !== "all" && (!tone || (tone.saturation < 0.35 ? "muted" : "vivid") !== filters.saturation)) return false;
    if (filters.duration !== "all") {
      const seconds = item.durationSeconds;
      if (item.kind !== "video" || seconds === undefined || !Number.isFinite(seconds)) return false;
      const duration = seconds < 30 ? "short" : seconds < 300 ? "medium" : "long";
      if (duration !== filters.duration) return false;
    }
    if (dates.from !== undefined || dates.until !== undefined) {
      if (item.createdAt === undefined || !Number.isFinite(item.createdAt)) return false;
      if (dates.from !== undefined && item.createdAt < dates.from) return false;
      if (dates.until !== undefined && item.createdAt >= dates.until) return false;
    }
    return true;
  });
  const descending = sort.endsWith("desc");
  rows.sort((a, b) => {
    let order: number;
    if (sort.startsWith("name")) {
      order = collator.compare(a.item.originalName ?? a.item.name, b.item.originalName ?? b.item.name);
    } else {
      const field = sort.startsWith("created") ? "createdAt" : sort.startsWith("size") ? "bytes" : "aspect";
      const av = a.item[field];
      const bv = b.item[field];
      const aKnown = av !== undefined && Number.isFinite(av);
      const bKnown = bv !== undefined && Number.isFinite(bv);
      // 未知元数据始终在最后，不能伪装成时间 0 或零字节参与排序。
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      order = aKnown && bKnown ? (av ?? 0) - (bv ?? 0) : 0;
    }
    return (descending ? -order : order) || a.index - b.index;
  });
  return rows.map(({ item }) => item);
}
