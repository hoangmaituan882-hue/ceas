//! SQLite 主库：迁移与写入在事务中提交，删除不级联。
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ItemRow {
    pub id: String,
    pub hash: String,
    pub name: String,
    pub w: i64,
    pub h: i64,
    pub bytes: i64,
    pub kind: String,
    pub duration: Option<f64>,
    pub ext: Option<String>,
    pub color: Option<String>,
    pub created_at: i64,
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default)]
    pub deleted_seq: Option<i64>,
    #[serde(default)]
    pub relative_path: Option<String>,
    #[serde(default)]
    pub collection_id: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub rating: u8,
    #[serde(default)]
    pub palette: Vec<String>,
    #[serde(default)]
    pub modified_at: Option<i64>,
}
#[derive(Debug, Serialize)]
pub struct StoreStats {
    pub items: i64,
    pub visible: i64,
    pub tags: i64,
    pub size_bytes: u64,
}

pub fn validate_root(root: &Path) -> Result<(), String> {
    if !root.is_absolute() {
        return Err("资料库必须使用绝对路径".into());
    }
    // 同时检查现存祖先，防止 E 盘 junction 实际指向 C 盘。
    for path in std::iter::once(root.to_path_buf())
        .chain(root.ancestors().filter_map(|p| p.canonicalize().ok()))
    {
        let text = path
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase();
        if text.starts_with("c:/") || text.starts_with("//?/c:/") {
            return Err("请选择非 C 盘资料库位置".into());
        }
    }
    Ok(())
}
pub fn open(root: &Path) -> Result<Connection, String> {
    crate::store_schema::open(root)
}
fn write_items(tx: &Transaction<'_>, rows: &[ItemRow]) -> Result<(), String> {
    let mut stmt = tx.prepare("insert into items(id,hash,name,w,h,bytes,kind,duration,ext,color,created_at,site,deleted_seq,relative_path,description,source_url,rating,palette,modified_at,collection_id)
        values(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
        on conflict(id) do update set hash=excluded.hash,name=excluded.name,w=excluded.w,h=excluded.h,
        bytes=excluded.bytes,kind=excluded.kind,duration=excluded.duration,ext=excluded.ext,
        color=excluded.color,created_at=excluded.created_at,site=excluded.site,
        relative_path=excluded.relative_path,collection_id=excluded.collection_id,description=excluded.description,source_url=excluded.source_url,
        rating=excluded.rating,palette=excluded.palette,modified_at=excluded.modified_at,
        deleted_seq=coalesce(items.deleted_seq,excluded.deleted_seq) where items.deleted_seq is null").map_err(|e| e.to_string())?;
    for row in rows {
        if row.id.is_empty() || row.hash.is_empty() || row.w <= 0 || row.h <= 0 || row.bytes < 0 {
            return Err("素材元数据不完整，未提交本批次".into());
        }
        if row.rating > 5 || row.palette.len() > 9 {
            return Err("评分须为 0–5，颜色索引最多九项".into());
        }
        if let Some(path) = &row.relative_path {
            crate::library_files::normalize_relative(path)?;
            let previous: Option<Option<String>> = tx
                .query_row(
                    "select relative_path from items where id=?1",
                    [&row.id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(Some(previous)) = previous {
                if previous != *path {
                    // 归档、撤销和外部改名都必须同时迁移来源地址，否则重试会重新复制原件。
                    crate::file_reconcile::source_paths(tx, &row.id, path)?;
                }
            }
        }
        let collection_id = row
            .relative_path
            .as_deref()
            .map(|p| crate::collection_store::parent(tx, p))
            .transpose()?
            .flatten();
        let hidden:bool=tx.query_row("select exists(select 1 from items where id=?1 and collection_id is not null and collection_id not in (select id from v_collections_visible))",[&row.id],|r|r.get(0)).map_err(|e|e.to_string())?;
        if hidden {
            return Err("素材所属收藏集已回收，已停止迟到写入".into());
        }
        stmt.execute(params![
            row.id,
            row.hash,
            row.name,
            row.w,
            row.h,
            row.bytes,
            row.kind,
            row.duration,
            row.ext,
            row.color,
            row.created_at,
            row.site,
            row.deleted_seq,
            row.relative_path,
            row.description,
            row.source_url,
            row.rating,
            serde_json::to_string(&row.palette).map_err(|e| e.to_string())?,
            row.modified_at,
            collection_id
        ])
        .map_err(|e| e.to_string())?;
    }
    tx.execute("update store_state set value=max(cast(value as integer),coalesce((select max(deleted_seq) from items),0)) where key='sequence'",[]).map_err(|e|e.to_string())?;
    Ok(())
}
/// 测试专用封装：生产走 `import_item_mode`（协议层要传 `preserve_manual`），
/// 这里保留一个少两个参数的版本给测试用，`#[cfg(test)]` 保证不进发布二进制。
#[cfg(test)]
pub fn import_item(
    root: &Path,
    row: ItemRow,
    tags: &[String],
    source_key: Option<&str>,
) -> Result<(), String> {
    import_item_mode(root, row, tags, source_key, false)
}
pub fn import_item_mode(
    root: &Path,
    mut row: ItemRow,
    tags: &[String],
    source_key: Option<&str>,
    preserve_manual: bool,
) -> Result<(), String> {
    let mut conn = open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let existing:Option<(String,String,u8,Option<String>,i64,Option<i64>)>=tx.query_row("select description,source_url,rating,site,created_at,deleted_seq from items where id=?1",[&row.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional().map_err(|e|e.to_string())?;
    let mut current_tags = None;
    if let Some((description, url, rating, site, created, deleted)) = existing {
        if deleted.is_some() {
            return Err("素材已经回收，已停止迟到写入".into());
        }
        if preserve_manual {
            row.description = description;
            row.source_url = url;
            row.rating = rating;
            row.site = site;
            row.created_at = created;
            let mut statement = tx
                .prepare("select tag from item_tags where item_id=?1")
                .map_err(|e| e.to_string())?;
            current_tags = Some(
                statement
                    .query_map([&row.id], |r| r.get::<_, String>(0))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?,
            );
        }
    }
    write_items(&tx, std::slice::from_ref(&row))?;
    write_tags(&tx, &row.id, current_tags.as_deref().unwrap_or(tags))?;
    if let Some(path) = &row.relative_path {
        if let Some((key, value)) = crate::file_observation::record(root, &row.id, path) {
            crate::file_reconcile::put_state(&tx, &key, &value)?;
        }
    }
    if let Some(source) = source_key {
        if source.is_empty() || source.len() > 16384 {
            return Err("导入来源标识无效".into());
        }
        let path = row.relative_path.as_deref().ok_or("导入来源缺少目标路径")?;
        tx.execute("insert into store_state values(?1,?2) on conflict(key) do update set value=excluded.value",
            params![format!("ceas.import-path.{source}"), path]).map_err(|e| e.to_string())?;
        crate::file_reconcile::put_state(&tx, &format!("ceas.import-id.{source}"), &row.id)?;
    }
    tx.commit().map_err(|e| e.to_string())
}
pub fn patch_metadata(
    root: &Path,
    id: &str,
    description: &str,
    url: &str,
    rating: u8,
    site: Option<&str>,
) -> Result<(), String> {
    if rating > 5 {
        return Err("评分须为 0–5".into());
    }
    let changed=open(root)?.execute("update items set description=?1,source_url=?2,rating=?3,site=?4 where id=?5 and id in (select id from v_items_visible)",params![description,url,rating,site,id]).map_err(|e|e.to_string())?;
    if changed == 0 {
        return Err("素材不存在或已回收，元数据未保存".into());
    }
    Ok(())
}
pub fn upsert_items(root: &Path, rows: &[ItemRow]) -> Result<usize, String> {
    let mut conn = open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    write_items(&tx, rows)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(rows.len())
}
fn write_tags(tx: &Transaction<'_>, id: &str, tags: &[String]) -> Result<(), String> {
    tx.execute("delete from item_tags where item_id=?1", [id])
        .map_err(|e| e.to_string())?;
    for tag in tags.iter().filter(|t| !t.trim().is_empty()) {
        tx.execute(
            "insert or ignore into item_tags values(?1,?2)",
            params![id, tag.trim()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn replace_tags(root: &Path, id: &str, tags: &[String]) -> Result<(), String> {
    let mut conn = open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let exists: bool = tx
        .query_row(
            "select exists(select 1 from v_items_visible where id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("素材不存在或已删除，标签未保存".into());
    }
    write_tags(&tx, id, tags)?;
    tx.commit().map_err(|e| e.to_string())
}
pub fn tags(root: &Path) -> Result<BTreeMap<String, Vec<String>>, String> {
    tags_view(root, false)
}
pub fn deleted_tags(root: &Path) -> Result<BTreeMap<String, Vec<String>>, String> {
    tags_view(root, true)
}
fn tags_view(root: &Path, trash: bool) -> Result<BTreeMap<String, Vec<String>>, String> {
    let conn = open(root)?;
    let sql = if trash {
        "select t.item_id,t.tag from item_tags t join v_items_deleted i on i.id=t.item_id order by t.item_id,t.tag"
    } else {
        "select item_id,tag from v_item_tags_visible order by item_id,tag"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut result = BTreeMap::<String, Vec<String>>::new();
    for row in rows {
        let (id, tag) = row.map_err(|e| e.to_string())?;
        result.entry(id).or_default().push(tag);
    }
    Ok(result)
}
pub fn has_hash(root: &Path, hash: &str) -> Result<bool, String> {
    open(root)?
        .query_row(
            "select exists(select 1 from items where hash=?1)",
            [hash],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
}
pub fn list(root: &Path, limit: usize) -> Result<Vec<ItemRow>, String> {
    list_view(root, limit, false)
}
pub fn list_trash(root: &Path) -> Result<Vec<ItemRow>, String> {
    list_view(root, 0, true)
}
fn list_view(root: &Path, limit: usize, trash: bool) -> Result<Vec<ItemRow>, String> {
    let conn = open(root)?;
    let view = if trash {
        "v_items_deleted"
    } else {
        "v_items_visible"
    };
    let mut stmt = conn.prepare(&format!("select id,hash,name,w,h,bytes,kind,duration,ext,color,created_at,site,deleted_seq,relative_path,description,source_url,rating,palette,modified_at,collection_id from {view} order by created_at,id limit ?1")).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([if limit == 0 { -1 } else { limit as i64 }], |r| {
            Ok(ItemRow {
                id: r.get(0)?,
                hash: r.get(1)?,
                name: r.get(2)?,
                w: r.get(3)?,
                h: r.get(4)?,
                bytes: r.get(5)?,
                kind: r.get(6)?,
                duration: r.get(7)?,
                ext: r.get(8)?,
                color: r.get(9)?,
                created_at: r.get(10)?,
                site: r.get(11)?,
                deleted_seq: r.get(12)?,
                relative_path: r.get(13)?,
                description: r.get(14)?,
                source_url: r.get(15)?,
                rating: r.get(16)?,
                palette: serde_json::from_str(&r.get::<_, String>(17)?).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        17,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                modified_at: r.get(18)?,
                collection_id: r.get(19)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
pub fn stats(root: &Path) -> Result<StoreStats, String> {
    let conn = open(root)?;
    let count = |table: &str| {
        conn.query_row(&format!("select count(*) from {table}"), [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|e| e.to_string())
    };
    Ok(StoreStats {
        items: count("items")?,
        visible: count("v_items_visible")?,
        tags: conn
            .query_row(
                "select count(distinct tag) from v_item_tags_visible",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?,
        size_bytes: std::fs::metadata(root.join(".ceas/library.db"))
            .map_err(|e| e.to_string())?
            .len(),
    })
}
pub fn state(root: &Path) -> Result<BTreeMap<String, String>, String> {
    let conn = open(root)?;
    let mut stmt = conn
        .prepare("select key,value from store_state where key!='sequence'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<BTreeMap<_, _>, _>>()
        .map_err(|e| e.to_string())
}
pub fn set_state(root: &Path, key: &str, value: &str) -> Result<(), String> {
    if !key.starts_with("ceas.") {
        return Err("不可写入内部状态键".into());
    }
    open(root)?.execute("insert into store_state values(?1,?2) on conflict(key) do update set value=excluded.value", params![key,value]).map_err(|e| e.to_string())?;
    Ok(())
}
/// 删除一个内部状态键（用于取消"忽略此文件"这类用户可撤回的设置）。
pub fn clear_state(root: &Path, key: &str) -> Result<(), String> {
    if !key.starts_with("ceas.") {
        return Err("不可写入内部状态键".into());
    }
    open(root)?
        .execute("delete from store_state where key=?1", [key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;

pub fn hidden_ids(root: &Path) -> Result<Vec<String>, String> {
    let conn = open(root)?;
    let mut stmt = conn
        .prepare("select id from items where id not in (select id from v_items_visible)")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
