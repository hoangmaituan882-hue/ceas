use crate::{library_files, store};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::path::Path;
#[derive(Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub path: String,
    pub identity: Option<String>,
    pub state: String,
    pub deleted_seq: Option<i64>,
}
#[derive(Deserialize)]
pub struct Change {
    pub id: String,
    pub previous: Option<String>,
    pub path: String,
    pub parent_id: Option<String>,
    pub identity: Option<String>,
}
#[derive(Deserialize)]
pub struct Draft {
    pub id: String,
    pub path: String,
}
pub fn ensure(root: &Path, entries: &[Draft]) -> Result<(), String> {
    crate::directory_operations::ensure_clear(root)?;
    ensure_for_task(root, entries)
}
pub fn ensure_for_task(root: &Path, entries: &[Draft]) -> Result<(), String> {
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut ordered = entries.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|e| e.path.split('/').count());
    for entry in ordered {
        library_files::normalize_relative(&entry.path)?;
        let exists: bool = tx
            .query_row(
                "select exists(select 1 from v_collections_visible where lower(path)=lower(?1))",
                [&entry.path],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists {
            continue;
        }
        crate::library_format::check_id(&entry.id)?;
        let path = library_files::checked_path(root, &entry.path)?;
        if !path.is_dir() || crate::file_observation::is_link(&path)? {
            return Err("目标收藏集不是可用的普通目录".into());
        }
        if let Some(identity) = crate::file_observation::identity(&path) {
            let moved: bool = tx
                .query_row(
                    "select exists(select 1 from v_collections_visible where identity=?1)",
                    [identity],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if moved {
                return Err("目录身份已在其他位置登记，请先核对目录再重试".into());
            }
        }
        let parent_id = parent(&tx, &entry.path)?;
        tx.execute("insert into collections(id,parent_id,name,path,identity,state) values(?1,?2,?3,?4,?5,'ready')",params![entry.id,parent_id,entry.path.rsplit('/').next().unwrap(),entry.path,crate::file_observation::identity(&path)]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
/// 测试夹具：在磁盘上建出目录并登记收藏集链（含祖先）。
///
/// 生产侧由前端两步完成同样的事（`create_library_folder` + `ensure_collections`），
/// 这里只是把两步合起来，避免每个测试文件各写一份。
#[cfg(test)]
pub fn test_folder(root: &Path, path: &str) {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(70000);
    std::fs::create_dir_all(root.join(path)).unwrap();
    let parts = path.split('/').collect::<Vec<_>>();
    let entries = (0..parts.len())
        .map(|index| Draft {
            id: format!(
                "019a0000-0000-7000-8000-{:012x}",
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ),
            path: parts[..=index].join("/"),
        })
        .collect::<Vec<_>>();
    ensure(root, &entries).unwrap();
}

pub fn list(root: &Path, trash: bool) -> Result<Vec<Collection>, String> {
    let conn = store::open(root)?;
    let view = if trash {
        "collections where deleted_seq is not null"
    } else {
        "v_collections_visible"
    };
    let mut stmt = conn
        .prepare(&format!(
            "select id,parent_id,name,path,identity,state,deleted_seq from {view} order by path"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Collection {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                name: r.get(2)?,
                path: r.get(3)?,
                identity: r.get(4)?,
                state: r.get(5)?,
                deleted_seq: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
/// 由素材相对路径解析所属收藏集。
///
/// **解析不到就是错误，不在存储层自动补建**：自动补建会让已回收目录的祖先
/// 被「重新出现」，破坏 ADR 0006 的祖先墓碑语义；调用方（导入、移动、核对）
/// 必须先用 `ensure` / `apply` 登记目录，再写入素材。
///
/// 早期这里有一条 `#[cfg(test)]` 分支，会在测试里静默插入 `missing` 祖先——
/// 那让单测覆盖了一条生产不存在的路径，等于没测。现在测试也走这条错误分支，
/// 由测试自己准备目录。
pub fn parent(tx: &Transaction<'_>, path: &str) -> Result<Option<String>, String> {
    let Some((folder, _)) = path.rsplit_once('/') else {
        return Ok(None);
    };
    let id = tx
        .query_row(
            "select id from v_collections_visible where lower(path)=lower(?1)",
            [folder],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match id {
        Some(id) => Ok(Some(id)),
        None => Err(format!("收藏集尚未核对，请先创建或核对目标目录：{folder}")),
    }
}
pub fn apply(root: &Path, changes: &[Change], missing: &[String]) -> Result<usize, String> {
    crate::directory_operations::ensure_clear(root)?;
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut changed = 0;
    let mut ids = std::collections::HashSet::new();
    let mut paths = std::collections::HashSet::new();
    for change in changes {
        crate::library_format::check_id(&change.id)?;
        if !ids.insert(&change.id) || !paths.insert(change.path.to_lowercase()) {
            return Err("目录核对存在重复身份或位置".into());
        }
        let path = library_files::checked_path(root, &change.path)?;
        if !path.is_dir()
            || crate::file_observation::is_link(&path)?
            || crate::file_observation::identity(&path) != change.identity
        {
            return Err("目录在核对期间改变，请重试".into());
        }
        let previous = tx
            .query_row(
                "select path from v_collections_visible where id=?1",
                [&change.id],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if previous != change.previous {
            return Err("目录身份或状态在核对期间改变".into());
        }
    }
    // 交换同级目录名称时先释放本批的唯一键，事务外不可见。
    for change in changes {
        tx.execute("update collections set name=id where id=?1", [&change.id])
            .map_err(|e| e.to_string())?;
    }
    for change in changes {
        let parent_path = change.path.rsplit_once('/').map(|(p, _)| p);
        if let Some(parent_id) = &change.parent_id {
            let parent_path_actual = changes
                .iter()
                .find(|c| c.id == *parent_id)
                .map(|c| c.path.clone())
                .or_else(|| {
                    tx.query_row(
                        "select path from v_collections_visible where id=?1",
                        [parent_id],
                        |r| r.get(0),
                    )
                    .ok()
                });
            if parent_path_actual.as_deref() != parent_path {
                return Err("父收藏集与目录位置不一致".into());
            }
        } else if parent_path.is_some() {
            return Err("目录缺少父收藏集".into());
        }
        let name = change.path.rsplit('/').next().unwrap();
        changed+=tx.execute("insert into collections(id,parent_id,name,path,identity,state) values(?1,?2,?3,?4,?5,'ready') on conflict(id) do update set parent_id=excluded.parent_id,name=excluded.name,path=excluded.path,identity=excluded.identity,state='ready'",params![change.id,change.parent_id,name,change.path,change.identity]).map_err(|e|e.to_string())?;
    }
    for id in missing {
        if ids.contains(id) {
            continue;
        }
        if let Some(path) = tx
            .query_row(
                "select path from v_collections_visible where id=?1",
                [id],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            let state = match library_files::checked_path(root, &path)
                .and_then(|p| std::fs::metadata(p).map_err(|e| e.to_string()))
            {
                Ok(m) if m.is_dir() => "unreadable",
                _ => "missing",
            };
            changed += tx
                .execute(
                    "update collections set state=?1 where id=?2 and state<>?1",
                    params![state, id],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changed)
}
pub fn relocate(
    tx: &Transaction<'_>,
    id: &str,
    original: &str,
    target: &str,
) -> Result<(), String> {
    let parent_id = parent(tx, target)?;
    let cycle:bool=tx.query_row("with recursive subtree(id) as (select ?1 union all select c.id from collections c join subtree s on c.parent_id=s.id) select exists(select 1 from subtree where id=?2)",params![id,parent_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if cycle {
        return Err("不能把收藏集移入自己或后代".into());
    }
    tx.execute(
        "update collections set parent_id=?1,name=?2 where id=?3",
        params![parent_id, target.rsplit('/').next().unwrap(), id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("with recursive subtree(id) as (select ?1 union all select c.id from collections c join subtree s on c.parent_id=s.id) update collections set path=?2||substr(path,length(?3)+1) where id in subtree",params![id,target,original]).map_err(|e|e.to_string())?;
    tx.execute("with recursive subtree(id) as (select ?1 union all select c.id from collections c join subtree s on c.parent_id=s.id) update items set relative_path=?2||substr(relative_path,length(?3)+1) where collection_id in subtree and relative_path is not null",params![id,target,original]).map_err(|e|e.to_string())?;
    Ok(())
}
