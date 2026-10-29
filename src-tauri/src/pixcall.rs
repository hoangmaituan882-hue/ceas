//! 只读取 Pixcall 的快照，绝不在源目录创建 SQLite WAL / SHM。
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT_SCAN: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize, Clone)]
pub struct PixcallEntry {
    pub source_id: String,
    pub name: String,
    pub rel_path: String,
    pub path: String,
    pub tags: Vec<String>,
    pub size: i64,
    pub content_type: String,
    pub readable: bool,
    pub description: String,
    pub source_url: String,
    pub rating: u8,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct PixcallTagGroup {
    pub source_id: String,
    pub name: String,
    pub color: Option<String>,
    pub tags: Vec<String>,
}
#[derive(Debug, Serialize)]
pub struct PixcallScan {
    pub root: String,
    pub total: usize,
    pub readable: usize,
    pub tag_count: usize,
    pub entries: Vec<PixcallEntry>,
    pub folders: Vec<String>,
    pub tag_groups: Vec<PixcallTagGroup>,
    pub warnings: Vec<String>,
    pub truncated: bool,
}
fn db_path(root: &Path) -> PathBuf {
    root.join(".pixcall/database/main.db")
}
struct Snapshot(PathBuf);
impl Drop for Snapshot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn fingerprint(path: &Path) -> Option<(u64, Option<std::time::SystemTime>)> {
    fs::metadata(path)
        .ok()
        .map(|m| (m.len(), m.modified().ok()))
}
fn snapshot(root: &Path) -> Result<Snapshot, String> {
    let source = db_path(root);
    if !source.is_file() {
        return Err("缺少 .pixcall/database/main.db，不是可读取的 Pixcall 资料库".into());
    }
    let source_wal = source.with_file_name("main.db-wal");
    for _ in 0..3 {
        let directory = std::env::temp_dir().join(format!(
            "ceas-pixcall-{}-{}",
            std::process::id(),
            NEXT_SCAN.fetch_add(1, Ordering::Relaxed)
        ));
        crate::store::validate_root(&directory)?;
        fs::create_dir(&directory).map_err(|e| e.to_string())?;
        let copy = Snapshot(directory);
        let before = (fingerprint(&source), fingerprint(&source_wal));
        fs::copy(&source, copy.0.join("main.db")).map_err(|e| e.to_string())?;
        if before.1.is_some() {
            fs::copy(&source_wal, copy.0.join("main.db-wal")).map_err(|e| e.to_string())?;
        }
        if before == (fingerprint(&source), fingerprint(&source_wal)) {
            return Ok(copy);
        }
    }
    Err("Pixcall 正在修改资料库，请等待任务结束后重新扫描".into())
}
fn columns(conn: &Connection, table: &str) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare(&format!("pragma table_info({table})"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get(1))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|e| e.to_string())
}
#[derive(Clone)]
struct Folder {
    parent: i64,
    name: String,
    deleted: bool,
}
fn folder_path(id: i64, folders: &HashMap<i64, Folder>) -> Result<Option<String>, String> {
    if id == 0 || id == -1 {
        return Ok(Some(String::new()));
    }
    let mut parts = Vec::new();
    let mut seen = HashSet::new();
    let mut current = id;
    while current > 0 {
        if !seen.insert(current) || seen.len() > 128 {
            return Err("目录父链循环或层级过深".into());
        }
        let folder = folders.get(&current).ok_or("目录父链缺失")?;
        if folder.deleted
            || (current == 2 && folder.parent <= 0 && folder.name.eq_ignore_ascii_case("Trash"))
        {
            return Ok(None);
        }
        if current == 1 && folder.parent <= 0 {
            break;
        }
        let component = crate::library_files::normalize_relative(&folder.name)?;
        if component.contains('/') {
            return Err("文件夹名称包含路径分隔符".into());
        }
        parts.push(component);
        current = folder.parent;
    }
    parts.reverse();
    Ok(Some(parts.join("/")))
}

pub fn scan(root: &Path, limit: usize) -> Result<PixcallScan, String> {
    let snapshot = snapshot(root)?;
    // 写入仅发生在 E 盘临时快照，SQLite 可在此重建 SHM 并读取已提交 WAL。
    let conn = Connection::open_with_flags(
        snapshot.0.join("main.db"),
        OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .map_err(|e| e.to_string())?;
    let integrity: String = conn
        .query_row("pragma quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if integrity != "ok" {
        return Err("Pixcall 数据库快照校验失败，请重试扫描".into());
    }
    let cols = columns(&conn, "entries")?;
    for required in ["id", "parent_id", "name", "kind"] {
        if !cols.contains(required) {
            return Err(format!("不支持此 Pixcall 数据库结构，缺少 {required}"));
        }
    }
    let field = |name: &str, fallback: &str| {
        if cols.contains(name) {
            format!("coalesce({name},{fallback})")
        } else {
            fallback.into()
        }
    };
    let text_field = |name: &str| {
        if cols.contains(name) {
            format!("cast({name} as text)")
        } else {
            "null".into()
        }
    };
    let mut warnings = Vec::new();
    for field in [
        "description",
        "link",
        "rating",
        "created_at",
        "updated_at",
        "is_deleted",
    ] {
        if !cols.contains(field) {
            warnings.push(format!("旧数据库缺少 {field}，对应信息无法保留"));
        }
    }
    let mut folders = HashMap::new();
    let mut stmt = conn
        .prepare(&format!(
            "select id,parent_id,name,{} from entries where kind=0",
            field("is_deleted", "0")
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                Folder {
                    parent: r.get::<_, Option<i64>>(1)?.unwrap_or(-1),
                    name: r.get(2)?,
                    deleted: r.get::<_, i64>(3)? != 0,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, folder) = row.map_err(|e| e.to_string())?;
        folders.insert(id, folder);
    }
    let mut folder_paths = Vec::new();
    for id in folders.keys() {
        match folder_path(*id, &folders) {
            Ok(Some(path)) if !path.is_empty() => folder_paths.push(path),
            Err(reason) => warnings.push(format!("文件夹 {id}：{reason}")),
            _ => (),
        }
    }
    folder_paths.sort();
    folder_paths.dedup();

    let tag_columns = columns(&conn, "tags")?;
    let mut tag_groups = Vec::new();
    if !columns(&conn, "tag_groups")?.is_empty() {
        let mut stmt = conn
            .prepare("select id,name,color from tag_groups order by id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(PixcallTagGroup {
                    source_id: r.get::<_, i64>(0)?.to_string(),
                    name: r.get(1)?,
                    color: r.get(2)?,
                    tags: Vec::new(),
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            tag_groups.push(row.map_err(|e| e.to_string())?);
        }
    }
    let mut tag_names = HashMap::new();
    if !tag_columns.is_empty() {
        let group = if tag_columns.contains("group_id") {
            "group_id"
        } else {
            "null"
        };
        let mut stmt = conn
            .prepare(&format!("select id,name,{group} from tags order by id"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let tags = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut counts = HashMap::new();
        for (_, name, _) in &tags {
            *counts.entry(name.clone()).or_insert(0) += 1;
        }
        for (id, name, group_id) in tags {
            let group = tag_groups
                .iter_mut()
                .find(|g| g.source_id == group_id.unwrap_or(-1).to_string());
            let display = if counts[&name] > 1 {
                format!(
                    "{}/{}",
                    group.as_ref().map(|g| g.name.as_str()).unwrap_or("未分组"),
                    name
                )
            } else {
                name
            };
            if let Some(group) = group {
                group.tags.push(display.clone());
            }
            tag_names.insert(id, display);
        }
    }

    let sql = format!(
        "select id,parent_id,name,{},{},{},{},{},{},{},{},{} from entries where kind=1 order by id",
        field("tags", "''"),
        field("size", "0"),
        field("content_type", "''"),
        field("is_deleted", "0"),
        field("description", "''"),
        field("link", "''"),
        field("rating", "0"),
        text_field("created_at"),
        text_field("updated_at")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, i64>(9)?,
                r.get::<_, Option<String>>(10)?,
                r.get::<_, Option<String>>(11)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let mut total = 0;
    let mut readable = 0;
    for row in rows {
        let (
            id,
            parent,
            name,
            tags_raw,
            size,
            content_type,
            deleted,
            description,
            source_url,
            rating,
            created_at,
            modified_at,
        ) = row.map_err(|e| e.to_string())?;
        if deleted != 0 {
            continue;
        }
        let parent_path = match folder_path(parent, &folders) {
            Ok(Some(path)) => path,
            Ok(None) => continue,
            Err(reason) => {
                warnings.push(format!("条目 {id}：{reason}"));
                continue;
            }
        };
        let component = match crate::library_files::normalize_relative(&name) {
            Ok(value) if !value.contains('/') => value,
            _ => {
                warnings.push(format!("条目 {id} 文件名不安全，已跳过"));
                continue;
            }
        };
        let rel_path = if parent_path.is_empty() {
            component
        } else {
            format!("{parent_path}/{component}")
        };
        let absolute = match crate::library_files::checked_path(root, &rel_path) {
            Ok(path) => path,
            Err(reason) => {
                warnings.push(format!("条目 {id}：{reason}"));
                continue;
            }
        };
        let is_readable = absolute.is_file();
        total += 1;
        if is_readable {
            readable += 1;
        }
        if limit > 0 && entries.len() >= limit {
            continue;
        }
        let tags = tags_raw
            .split('|')
            .filter_map(|value| value.trim().parse::<i64>().ok())
            .filter_map(|id| tag_names.get(&id).cloned())
            .collect();
        entries.push(PixcallEntry {
            source_id: id.to_string(),
            name,
            rel_path,
            path: absolute.to_string_lossy().to_string(),
            tags,
            size,
            content_type,
            readable: is_readable,
            description,
            source_url,
            rating: rating.clamp(0, 5) as u8,
            created_at,
            modified_at,
        });
    }
    entries.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    let truncated = entries.len() < total;
    Ok(PixcallScan {
        root: root.to_string_lossy().to_string(),
        total,
        readable,
        tag_count: tag_names.len(),
        entries,
        folders: folder_paths,
        tag_groups,
        warnings,
        truncated,
    })
}

pub fn read_file_base64(path: &Path) -> Result<(String, usize), String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let bytes = fs::read(path).map_err(|e| format!("读取失败：{e}"))?;
    Ok((B64.encode(&bytes), bytes.len()))
}
#[cfg(test)]
#[path = "pixcall_tests.rs"]
mod tests;
