import { readLibraryState, writeLibraryState, flushLibraryState } from "./library-state";
import type { TagGroup } from "./desktop";
export type { FolderCollection as Collection } from "@ceas/core/library-path";
const FOLDERS = "ceas.folders.v1", GROUPS = "ceas.tag-groups.v1";
export function loadFolders(): string[] {
  try { const value:unknown=JSON.parse(readLibraryState(FOLDERS)??"[]");return Array.isArray(value)?value.filter((entry):entry is string=>typeof entry==="string"):[]; }catch{return [];}
}
export function loadTagGroups(): TagGroup[] {
  try {const value:unknown=JSON.parse(readLibraryState(GROUPS)??"[]");return Array.isArray(value)?value.filter((entry):entry is TagGroup=>
    typeof entry==="object"&&entry!==null&&typeof entry.id==="string"&&typeof entry.name==="string"&&Array.isArray(entry.tags)&&entry.tags.every((tag:unknown)=>typeof tag==="string")):[];}catch{return [];}
}
export async function saveFolders(paths: string[]) {
  writeLibraryState(FOLDERS,JSON.stringify([...new Set(paths)]));await flushLibraryState();window.dispatchEvent(new Event("ceas-folders-changed"));
}
export async function saveTagGroups(groups: TagGroup[]) {
  const tags=new Set<string>();
  for(const group of groups) for(const tag of group.tags){if(tags.has(tag))throw new Error(`标签「${tag}」同时出现在两个标签组`);tags.add(tag);}
  writeLibraryState(GROUPS,JSON.stringify(groups));await flushLibraryState();window.dispatchEvent(new Event("ceas-folders-changed"));
}
