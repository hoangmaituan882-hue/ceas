/** 时间只参与 UUIDv7 标识，不参与写入冲突或删除定序。 */
export function uuidv7(): string {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  let time=Date.now();
  for(let i=5;i>=0;i--){bytes[i]=time%256;time=Math.floor(time/256);}
  bytes[6]=((bytes[6]??0)&0x0f)|0x70;
  bytes[8]=((bytes[8]??0)&0x3f)|0x80;
  const hex=Array.from(bytes,(value)=>value.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
