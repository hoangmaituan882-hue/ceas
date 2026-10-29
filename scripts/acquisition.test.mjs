import test from "node:test";
import assert from "node:assert/strict";
import {resolveAcquisitionTarget} from "../packages/core/acquisition.ts";
const collections=[{id:"collection:a",path:"参考/海报",label:"海报",state:"ready"},{id:"collection:b",path:"空集",label:"空集",state:"missing"}];
test("当前位置决定落点，查询和标签回到收件箱，侧栏明确落点优先",()=>{
 assert.deepEqual(resolveAcquisitionTarget("all",false,collections),{path:"",label:"收件箱"});assert.equal(resolveAcquisitionTarget("collection:a",false,collections).path,"参考/海报");assert.equal(resolveAcquisitionTarget("collection:a",false,collections).collectionId,"a");assert.equal(resolveAcquisitionTarget("collection:a",true,collections).path,"");assert.equal(resolveAcquisitionTarget("tag:参考",false,collections).path,"");assert.equal(resolveAcquisitionTarget("all",true,collections,"collection:a").path,"参考/海报");
});
test("回收站和不可用收藏集明确拒绝，不把失效路径变成新目录",()=>{
 assert.match(resolveAcquisitionTarget("trash",false,collections).error,/不能导入/);assert.match(resolveAcquisitionTarget("collection:b",false,collections).error,/不可用/);assert.match(resolveAcquisitionTarget("collection:gone",false,collections).error,/已改变/);assert.equal(resolveAcquisitionTarget("trash",false,collections,"collection:a").path,"参考/海报");
});
