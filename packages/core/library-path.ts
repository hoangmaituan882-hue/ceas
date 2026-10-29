/** 路径是跨 Windows / Linux / 离线包的地址，不能把平台绝对路径写进索引。 */
export function normalizeLibraryPath(value: string): string {
  const path = value.replaceAll("\\", "/");
  const parts = path.split("/");
  if (!path || path.startsWith("/") || parts.some((part) =>
    !part || part === "." || part === ".." || /[<>:"|?*\u0000-\u001f]/u.test(part)
    || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
    || [".ceas", ".pixcall"].includes(part.toLowerCase()))) {
    throw new Error("文件名或目录不可跨平台使用，请检查空名称、保留名称和特殊字符");
  }
  return parts.join("/");
}

export const parentPath = (path: string): string => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
export const inFolder = (path: string | undefined, folder: string): boolean =>
  Boolean(path && (parentPath(path) === folder || path.startsWith(`${folder}/`)));

export type FolderCollection = { id: string; path: string; label: string; depth: number };
export function folderCollections(paths: readonly string[], emptyFolders: readonly string[] = []): FolderCollection[] {
  const folders = new Set<string>();
  for (const path of [...paths.map(parentPath), ...emptyFolders]) {
    const parts = path.split("/").filter(Boolean);
    for (let length = 1; length <= parts.length; length++) folders.add(parts.slice(0, length).join("/"));
  }
  const collator=new Intl.Collator("zh-CN",{numeric:true});
  return [...folders].sort((a,b)=>{
    const left=a.split("/"),right=b.split("/");
    for(let index=0;index<Math.max(left.length,right.length);index++){
      if(left[index]===undefined)return -1;if(right[index]===undefined)return 1;
      const order=collator.compare(left[index]??"",right[index]??"");if(order)return order;
    }return 0;
  }).map((path) => ({
    id: `folder:${path}`, path, label: path.split("/").at(-1) ?? path, depth: path.split("/").length,
  }));
}
