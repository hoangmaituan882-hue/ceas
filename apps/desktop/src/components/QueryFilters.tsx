import { COLOR_LABELS, type ItemFilters } from "@ceas/core/item-query";
import type { ItemQuery } from "@/data/use-item-query";

function SelectField<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void;
}) {
  return (
    <label className="query-field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => {
        const option = options.find(([key]) => key === event.target.value);
        if (option) onChange(option[0]);
      }}>
        {options.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
      </select>
    </label>
  );
}

export function QueryFilters({ query }: { query: ItemQuery }) {
  return (
    <div className="query-fields">
      <SelectField label="素材类型" value={query.filters.kind}
        options={[["all", "全部类型"], ["image", "图片"], ["video", "视频"], ["file", "其他文件"], ["link", "链接"]]}
        onChange={(value) => query.setFilter("kind", value)} />
      <SelectField label="宽高比" value={query.filters.aspect}
        options={[["all", "全部比例"], ["landscape", "横图"], ["portrait", "竖图"], ["square", "近方形（0.95–1.05）"]]}
        onChange={(value) => query.setFilter("aspect", value)} />
      <SelectField label="标签" value={query.filters.tag}
        options={[["", "全部标签"], ...query.availableTags.map((tag): [string, string] => [tag, tag])]}
        onChange={(value) => query.setFilter("tag", value)} />
      {query.sites.length > 0 ? (
        <SelectField label="来源站点" value={query.filters.site}
          options={[["", "全部来源"], ...query.sites.map((site): [string, string] => [site, site])]}
          onChange={(value) => query.setFilter("site", value)} />
      ) : null}
      <SelectField label="主色" value={query.filters.color}
        options={[["all", "全部颜色"], ...(Object.entries(COLOR_LABELS) as [Exclude<ItemFilters["color"], "all">, string][])]}
        onChange={(value) => query.setFilter("color", value)} />
      <label className="query-field"><span>相似颜色（HEX / RGB）</span><input value={query.filters.similarColor} onChange={(event)=>query.setFilter("similarColor",event.target.value)}/></label>
      <SelectField label="评分" value={query.filters.rating}
        options={[["all","全部评分"],["unrated","未评分"],["1","至少 1 星"],["2","至少 2 星"],["3","至少 3 星"],["4","至少 4 星"],["5","5 星"]]}
        onChange={(value)=>query.setFilter("rating",value)} />
      <SelectField label="亮度" value={query.filters.lightness}
        options={[["all", "全部亮度"], ["dark", "暗色"], ["medium", "中等亮度"], ["light", "亮色"]]}
        onChange={(value) => query.setFilter("lightness", value)} />
      <SelectField label="饱和度" value={query.filters.saturation}
        options={[["all", "全部饱和度"], ["muted", "低饱和"], ["vivid", "高饱和"]]}
        onChange={(value) => query.setFilter("saturation", value)} />
      <SelectField label="视频时长" value={query.filters.duration}
        options={[["all", "不限时长"], ["short", "短于 30 秒"], ["medium", "30 秒至不足 5 分钟"], ["long", "5 分钟及以上"]]}
        onChange={(value) => query.setFilter("duration", value)} />
      <label className="query-field">
        <span>导入日期：从</span>
        <input type="date" value={query.filters.dateFrom} max={query.filters.dateTo || undefined}
          onChange={(event) => query.setFilter("dateFrom", event.target.value)} />
      </label>
      <label className="query-field">
        <span>导入日期：至（含当天）</span>
        <input type="date" value={query.filters.dateTo} min={query.filters.dateFrom || undefined}
          onChange={(event) => query.setFilter("dateTo", event.target.value)} />
      </label>
      {query.dateError ? <p className="query-error" role="alert">{query.dateError}</p> : null}
      <p className="query-help">条件同时满足才显示；时长条件仅匹配视频，未知元数据不参与对应筛选。</p>
      <button type="button" className="query-action" onClick={query.resetFilters} disabled={query.filterCount === 0}>
        重置筛选
      </button>
    </div>
  );
}
