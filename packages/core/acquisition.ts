import {normalizeLibraryPath} from "./library-path.ts";

export type AcquisitionCollection={id:string;path:string;label:string;state?:string};
export type AcquisitionTarget={path:string;label:string;collectionId?:string;error?:string};
/** 导入归属在手势发生时固定；查询只是观察条件，不能成为磁盘位置。 */
export function resolveAcquisitionTarget(place:string,filtered:boolean,collections:readonly AcquisitionCollection[],hoverId?:string):AcquisitionTarget{
 const id=hoverId??place;
 if(!hoverId&&place==="trash")return {path:"",label:"回收站",error:"回收站不能导入"};
 if(hoverId||(!filtered&&(id.startsWith("collection:")||id.startsWith("folder:")))){
  const row=collections.find(row=>row.id===id);
  if(!row)return {path:"",label:"收藏集",error:"收藏集已改变，请重新选择"};
  if(row.state&&row.state!=="ready")return {path:row.path,label:row.label,error:"收藏集目录当前不可用，请先检查文件变化"};
  return {path:normalizeLibraryPath(row.path),label:row.label,...(id.startsWith("collection:")?{collectionId:id.slice(11)}:{})};
 }
 return {path:"",label:"收件箱"};
}
