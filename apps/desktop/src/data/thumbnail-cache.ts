/** 只缓存可重建的缩略图，不把桌面主库元数据写回旧版迁移源。 */
let connection:Promise<IDBDatabase>|null=null;
function open() {
  connection??=new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open("ceas-thumbnails",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("thumbs",{keyPath:"hash"});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return connection;
}
export async function getThumbnail(hash:string):Promise<Blob|undefined> {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const request=db.transaction("thumbs","readonly").objectStore("thumbs").get(hash) as IDBRequest<{thumb:Blob}|undefined>;
    request.onsuccess=()=>resolve(request.result?.thumb);request.onerror=()=>reject(request.error);
  });
}
export async function putThumbnail(hash:string,thumb:Blob):Promise<void> {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("thumbs","readwrite");tx.objectStore("thumbs").put({hash,thumb});
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
  });
}
