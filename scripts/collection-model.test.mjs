import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "../apps/desktop/node_modules/typescript/lib/typescript.js";
const source=ts.transpileModule(readFileSync("packages/core/collection-model.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {planCollections,collectionDescendants,indexCollections}=await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const row=(id,path,identity,parent_id=null)=>({id,path,name:path.split("/").at(-1),identity,parent_id,state:"ready",deleted_seq:null});
test("目录改名交换及父级移动保持身份，新的父子关系完整",()=>{
 const rows=[row("a","A","one"),row("b","B","two"),row("c","A/子集","three","a")];
 const plan=planCollections(rows,[{path:"B",identity:"one"},{path:"A",identity:"two"},{path:"A/子集",identity:"three"}],()=>"new");
 assert.deepEqual(plan.changes.map(change=>[change.id,change.path,change.parent_id]),[["a","B",null],["b","A",null],["c","A/子集","b"]]);assert.deepEqual(plan.missing,[]);
});
test("无文件身份时原路径保留，缺失目录留下信息，新目录获得客户端身份",()=>{
 const plan=planCollections([row("a","参考",null),row("missing","暂缺",null)],[{path:"参考",identity:null},{path:"新集",identity:null}],()=>"client-id");
 assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].id,"client-id");assert.deepEqual(plan.missing,["missing"]);
});
test("重复身份不猜归属，按路径证据匹配，子树遍历有环保护",()=>{
 const plan=planCollections([row("a","A","shared")],[{path:"A",identity:"shared"},{path:"B",identity:"shared"}],()=>"new");assert.deepEqual(plan.changes.map(row=>row.id),["new"]);
 assert.deepEqual([...collectionDescendants([{id:"a",parent_id:"b"},{id:"b",parent_id:"a"},{id:"c",parent_id:"b"}],"a")].sort(),["a","b","c"]);
});

test("一万目录索引避免逐目录重复建树，无变化核对不提交写入",()=>{
 const rows=Array.from({length:10000},(_,i)=>row(`id-${i}`,`folder-${i}`,`identity-${i}`,i?`id-${Math.floor((i-1)/10)}`:null));
 const started=performance.now(),index=indexCollections(rows),elapsed=performance.now()-started;assert.equal(index.descendants.get("id-0").size,10000);assert.ok(elapsed<200,`目录索引 ${elapsed}ms`);
 const plain=rows.map(row=>({...row,parent_id:null}));assert.equal(planCollections(plain,plain.map(row=>({path:row.path,identity:row.identity})),()=>{throw new Error("未变化目录不应生成新身份");}).changes.length,0);console.log(`10,000 目录身份索引：${elapsed.toFixed(1)}ms`);
});
