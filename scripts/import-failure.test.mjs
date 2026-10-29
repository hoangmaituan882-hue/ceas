import test from "node:test";
import assert from "node:assert/strict";
import {classifyImportFailure} from "../apps/desktop/src/data/import-failure.ts";

test("解码失败是可解释的状态，不是原始英文异常",()=>{
 const verdict=classifyImportFailure("The source image could not be decoded.");
 assert.equal(verdict.kind,"decode");
 assert.equal(verdict.state,"decode","只有这一类要落成持久状态并停止自动重试");
 assert.match(verdict.text,/无法解码/);
 assert.match(verdict.hint,/普通文件/);
});

test("空间、权限、文件不在各有各的说法，且都不写死状态",()=>{
 for(const [reason,kind] of [["os error 112: 磁盘空间不足","space"],["Access is denied. (os error 5)","permission"],["No such file or directory (os error 2)","unreadable"]]){
  const verdict=classifyImportFailure(reason);
  assert.equal(verdict.kind,kind,reason);
  assert.equal(verdict.state,null,"下次核对自己会重新判断，不该钉死");
  assert.ok(verdict.hint.length>0);
 }
});

test("认不出来的原因照原样说明，并说明会再试一次",()=>{
 const verdict=classifyImportFailure("  something odd  ");
 assert.equal(verdict.kind,"unknown");
 assert.equal(verdict.text,"something odd");
 assert.equal(verdict.state,null);
 assert.match(verdict.hint,/再试/);
 const blank=classifyImportFailure("");
 assert.equal(blank.kind,"unknown");
 assert.ok(blank.text.length>0,"空原因也要有一句话");
});
