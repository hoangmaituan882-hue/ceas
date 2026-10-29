import test from "node:test";
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {planFileReconciliation,sameObservation} from "../packages/core/file-reconcile.ts";
const obs=(identity)=>({size:3,stamp:"100",identity});
const row=(id,path,hash=id)=>({id,hash,relative_path:path});
const entry=(path,identity,hash)=>({name:path.split("/").at(-1),rel_path:path,path:`E:/test/${path}`,...obs(identity),hash});
const record=(path,identity)=>({path,...obs(identity),state:"ready"});
test("文件身份处理改名交换、大小写变化和原位置出现新文件",()=>{
 const rows=[row("a","A.png"),row("b","B.png")],records={a:record("A.png","fa"),b:record("B.png","fb")};
 let plan=planFileReconciliation(rows,[entry("B.png","fa","a"),entry("A.png","fb","b")],records);
 assert.deepEqual(plan.matches.map(x=>[x.id,x.entry.rel_path]),[["a","B.png"],["b","A.png"]]);assert.equal(plan.imports.length,0);
 plan=planFileReconciliation([rows[0]],[entry("a.PNG","fa","a"),entry("新/A.png","new","x")],records);assert.equal(plan.matches[0].id,"a");assert.equal(plan.imports.length,1);
 plan=planFileReconciliation([rows[0]],[entry("移动/A.png","fa","a"),entry("A.png","new","x")],records);assert.equal(plan.matches[0].entry.rel_path,"移动/A.png");assert.equal(plan.imports[0].rel_path,"A.png");
});
test("相同内容双方唯一才按哈希关联，多候选明确留待确认",()=>{
 const rows=[row("a","old.png","same"),row("b","other.png","same")];
 let plan=planFileReconciliation(rows,[entry("new.png",null,"same")],{});assert.equal(plan.matches.length,0);assert.equal(plan.imports.length,0);assert.equal(plan.ambiguous.length,1);assert.equal(plan.missing.length,2);
 plan=planFileReconciliation([rows[0]],[entry("new.png",null,"same")],{});assert.equal(plan.matches[0].id,"a");assert.equal(plan.ambiguous.length,0);
 plan=planFileReconciliation([rows[0]],[entry("new.png",null,"same"),entry("new2.png",null,"same")],{});assert.equal(plan.matches.length,0);assert.equal(plan.ambiguous.length,2);
});
test("缺失不转删除、修改保留对象、已知未变化文件不重复导入",()=>{
 const rows=[row("a","A.png")],records={a:record("A.png","fa")};
 let plan=planFileReconciliation(rows,[],records);assert.deepEqual(plan.missing,["a"]);
 plan=planFileReconciliation(rows,[entry("A.png","fa","changed")],records);assert.equal(plan.imports.length,1);assert.equal(plan.matches.length,1);
 plan=planFileReconciliation(rows,[entry("A.png","fa","a")],records);assert.equal(plan.imports.length,0);assert.equal(plan.matches.length,0);
 assert.equal(sameObservation(obs("fa"),obs("fb")),false);
});
test("一万文件的无变化核对计划保持线性开销",()=>{
 const rows=Array.from({length:10000},(_,n)=>row(`id${n}`,`${n}.png`));const records=Object.fromEntries(rows.map(r=>[r.id,record(r.relative_path,r.id)]));const entries=rows.map(r=>entry(r.relative_path,r.id,r.hash));
 const started=performance.now();const plan=planFileReconciliation(rows,entries,records);const elapsed=performance.now()-started;
 assert.equal(plan.imports.length,0);assert.equal(plan.matches.length,0);assert.equal(plan.missing.length,0);assert.ok(elapsed<250,`核对计划 ${elapsed}ms`);console.log(`10,000 文件核对计划：${elapsed.toFixed(1)}ms`);
});

test("同路径同身份的内容修改只更新原素材，不新建也不重复导入",()=>{
 const rows=[row("a","画图/图.png")],records={a:record("画图/图.png","fa")};
 const plan=planFileReconciliation(rows,[entry("画图/图.png","fa","new-hash")],records);
 assert.equal(plan.matches.length,1,"内容变了要结算一次");
 assert.equal(plan.matches[0].id,"a","复用原 id");
 assert.equal(plan.matches[0].hash,"a");
 assert.equal(plan.matches[0].content_hash,"new-hash");
 assert.deepEqual(plan.imports.map(x=>x.rel_path),["画图/图.png"],"原地更新，不是多出一条");
 assert.deepEqual(plan.missing,[]);
 assert.equal(plan.ambiguous.length,0);
});
