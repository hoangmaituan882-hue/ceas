use rusqlite::{params, Connection, OpenFlags};
use std::path::Path;

pub fn initialize(database: &Path, id: &str, name: &str) -> Result<(), String> {
    let mut conn = Connection::open(database).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("create table library_meta(id text primary key,name text not null);
        create table items(id text primary key,hash text not null,name text not null,w integer not null,h integer not null,
        bytes integer not null,kind text not null,duration real,ext text,color text,created_at integer not null,
        deleted_at integer,site text,deleted_seq integer,relative_path text,description text not null default '',
        source_url text not null default '',rating integer not null default 0,palette text not null default '[]',modified_at integer,collection_id text);
        create index idx_items_hash on items(hash);
        create unique index idx_items_path on items(ifnull(collection_id,''),lower(name)) where relative_path is not null and deleted_seq is null;
        create table collections(id text primary key,parent_id text,name text not null,path text not null,identity text,state text not null,deleted_seq integer);
        create unique index idx_collection_siblings on collections(ifnull(parent_id,''),lower(name)) where deleted_seq is null;
        create index idx_collection_parent on collections(parent_id);
        create index idx_item_collection on items(collection_id);
        create view v_collections_visible as with recursive visible as (select * from collections where parent_id is null and deleted_seq is null union all select c.* from collections c join visible p on c.parent_id=p.id where c.deleted_seq is null) select * from visible;
        create index idx_items_created on items(created_at);
        create table item_tags(item_id text not null,tag text not null,primary key(item_id,tag));
        create index idx_item_tags_tag on item_tags(tag);
        create table store_state(key text primary key,value text not null);
        insert into store_state values('sequence','0');
        create view v_items_visible as select * from items where deleted_seq is null and (collection_id is null or collection_id in (select id from v_collections_visible));
        create view v_items_deleted as select * from items where deleted_seq is not null;
        create view v_item_tags_visible as select t.* from item_tags t join v_items_visible i on i.id=t.item_id;
        pragma user_version=5;").map_err(|e| e.to_string())?;
    tx.execute("insert into library_meta values(?1,?2)", params![id, name])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn open(root: &Path) -> Result<Connection, String> {
    let manifest = crate::library_format::manifest(root)?;
    let database = crate::library_format::internal_path(root, "library.db")?;
    // READ_WRITE without CREATE: a moved or missing library must never become an empty one.
    let conn = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| format!("资料库不可写或数据库缺失：{e}"))?;
    verify(&conn, &manifest.id)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn verify(conn: &Connection, id: &str) -> Result<String, String> {
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version != 5 {
        return Err("资料库格式不受支持；工程测试版请显式建立新库".into());
    }
    let (stored_id, name): (String, String) = conn
        .query_row("select id,name from library_meta", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|e| format!("资料库身份缺失：{e}"))?;
    if stored_id != id {
        return Err("资料库身份与数据库不一致".into());
    }
    Ok(name)
}
