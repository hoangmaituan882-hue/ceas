import test from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import { normalizeLibraryPath, folderCollections, inFolder } from "../packages/core/library-path.ts";
import { indexColors, colorDistance, parseColor } from "../packages/core/color-index.ts";
import { createItemIndex, selectItems, DEFAULT_FILTERS } from "../packages/core/item-query.ts";

test("普通目录保持原文件名和层级，危险或跨平台不兼容地址拒绝",()=>{
  assert.equal(normalizeLibraryPath("品牌参考\\海报.png"),"品牌参考/海报.png");
  for(const path of ["../secret","C:/x","/x","a//b","a/CON.png","a/x.","a/x ",".ceas/catalog.json"])assert.throws(()=>normalizeLibraryPath(path));
  const folders=folderCollections(["品牌/海报.png","品牌/材质/石头.jpg"],["空集"]);
  assert.deepEqual(new Set(folders.map((folder)=>folder.path)),new Set(["品牌","品牌/材质","空集"]));
  assert.equal(inFolder("品牌/材质/石头.jpg","品牌"),true);assert.equal(inFolder("品牌甲/a.jpg","品牌"),false);
});
test("九色索引保留实际多色而非平均成不存在的紫色，透明像素不污染",()=>{
  const palette=indexColors([255,0,0,255,0,0,255,255,0,255,0,0]);
  assert.deepEqual(new Set(palette),new Set(["rgb(255, 0, 0)","rgb(0, 0, 255)"]));
  assert.deepEqual(indexColors([255,0,0,0]),[]);
  const colors=Array.from({length:256},(_,index)=>[index,(index*31)%256,(index*67)%256,255]).flat();assert.ok(indexColors(colors).length<=9);
  assert.ok(colorDistance([255,0,0],[245,5,5])<colorDistance([255,0,0],[0,0,255]));
  assert.deepEqual(parseColor("#f00"),[255,0,0]);assert.equal(parseColor("rgb(999, 0, 0)"),null);
});
test("描述、来源、目录、评分和相似颜色参与检索，颜色约束命中同一采样色",()=>{
  const item={id:"a",name:"图",kind:"image",aspect:1,color:"rgb(128, 0, 128)",palette:["rgb(255, 0, 0)","rgb(0, 0, 255)"],relativePath:"品牌/海报.png",description:"极简建筑",sourceUrl:"https://example.com/ref",rating:4};
  const index=createItemIndex([item],{});
  const query=(text,filters={})=>selectItems(index,text,{...DEFAULT_FILTERS,...filters},"name-asc").length;
  assert.equal(query("极简 example 品牌",{rating:"4"}),1);assert.equal(query("",{rating:"5"}),0);
  assert.equal(query("",{similarColor:"#fc0505"}),1);assert.equal(query("",{similarColor:"#00ff00"}),0);
  assert.equal(query("",{color:"blue",lightness:"medium",saturation:"vivid"}),1);
});
test("一万张九色索引的相似颜色查询保持在 100ms 内",()=>{
  const rows=Array.from({length:10_000},(_,index)=>({id:String(index),name:String(index),kind:"image",aspect:1,color:"#f00",palette:["#f00","#f10","#f20","#f30","#f40","#f50","#f60","#f70","#00f"]}));
  const index=createItemIndex(rows,{}),start=performance.now();const result=selectItems(index,"",{...DEFAULT_FILTERS,similarColor:"#00f"},"created-asc");
  const elapsed=performance.now()-start;assert.equal(result.length,10_000);assert.ok(elapsed<100,`${elapsed}ms`);console.log(`10,000 项 × 9 色索引查询：${elapsed.toFixed(1)}ms`);
});
