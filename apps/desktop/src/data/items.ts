/* ══ 素材类型 ════════════════════════════════════════════════
   这里曾经生成 1800 条合成占位数据当兜底。但打包版拿不到开发态
   素材目录时，那 1800 条假素材会直接显示成"用户的库"——比空态
   糟糕得多，所以整段删掉了。现在只有类型定义。
   ------------------------------------------------------------ */

import type { QueryableItem } from "@ceas/core/item-query";

export type Kind = QueryableItem["kind"];

export type Item = QueryableItem & {
  fileState?: "ready"|"pending"|"missing"|"unreadable"|"decode";
  storedPath?:string;
  collectionId?:string;
  duration?: string;
  size: string;
  /** 真实图片地址；没有就用 color 占位 */
  src?: string;
};
