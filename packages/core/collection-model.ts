export type CollectionRow={id:string;parent_id:string|null;name:string;path:string;identity:string|null;state:string;deleted_seq:number|null};
export type DirectoryFact={path:string;identity:string|null};
export type CollectionChange={id:string;previous:string|null;path:string;parent_id:string|null;identity:string|null};
const key=(path:string)=>path.toLowerCase();
export function planCollections(rows:readonly CollectionRow[],facts:readonly DirectoryFact[],newId:()=>string){
 const used=new Set<string>(),assigned=new Map<string,CollectionRow>();
 const identities=new Map<string,CollectionRow[]>(),factCounts=new Map<string,number>();
 for(const fact of facts)if(fact.identity)factCounts.set(fact.identity,(factCounts.get(fact.identity)??0)+1);
 for(const row of rows)if(row.identity){const list=identities.get(row.identity)??[];list.push(row);identities.set(row.identity,list);}
 for(const fact of facts){const matches=fact.identity?identities.get(fact.identity):undefined;if(fact.identity&&factCounts.get(fact.identity)===1&&matches?.length===1&&matches[0]&&!used.has(matches[0].id)){assigned.set(key(fact.path),matches[0]);used.add(matches[0].id);}}
 const paths=new Map(rows.map(row=>[key(row.path),row]));
 for(const fact of facts)if(!assigned.has(key(fact.path))){const row=paths.get(key(fact.path));if(row&&!used.has(row.id)){assigned.set(key(fact.path),row);used.add(row.id);}}
 const ids=new Map(facts.map(fact=>[key(fact.path),assigned.get(key(fact.path))?.id??newId()]));
 const changes:CollectionChange[]=facts.map(fact=>{const row=assigned.get(key(fact.path));const parent=fact.path.includes("/")?fact.path.slice(0,fact.path.lastIndexOf("/")):null;return {id:ids.get(key(fact.path))??"",previous:row?.path??null,path:fact.path,parent_id:parent?ids.get(key(parent))??null:null,identity:fact.identity};}).filter(change=>{const row=assigned.get(key(change.path));return !row||row.path!==change.path||row.parent_id!==change.parent_id||row.identity!==change.identity||row.state!=="ready";});
 return {changes,missing:rows.filter(row=>!used.has(row.id)).map(row=>row.id)};
}
export function indexCollections(rows:readonly Pick<CollectionRow,"id"|"parent_id">[]){
 const parents=new Map(rows.map(row=>[row.id,row.parent_id])),descendants=new Map(rows.map(row=>[row.id,new Set<string>()])),ancestors=new Map<string,string[]>();
 for(const row of rows){const lineage:string[]=[],seen=new Set<string>();let cursor:string|null|undefined=row.id;while(cursor&&!seen.has(cursor)){seen.add(cursor);lineage.push(cursor);descendants.get(cursor)?.add(row.id);cursor=parents.get(cursor);}ancestors.set(row.id,lineage);}
 return {descendants,ancestors};
}
export function collectionDescendants(rows:readonly Pick<CollectionRow,"id"|"parent_id">[],id:string):Set<string>{
 const children=new Map<string,string[]>();for(const row of rows)if(row.parent_id){const list=children.get(row.parent_id)??[];list.push(row.id);children.set(row.parent_id,list);}
 const found=new Set<string>(),queue=[id];while(queue.length){const next=queue.pop();if(!next||found.has(next))continue;found.add(next);queue.push(...children.get(next)??[]);}return found;
}
