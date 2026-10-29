use crate::{
    collection_store, directory_tree, library_files, library_format, library_registry::write_json,
    store,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize)]
pub struct Operation {
    pub key: String,
    pub id: String,
    pub kind: String,
    pub original: String,
    pub source: String,
    pub target: String,
    pub phase: String,
    pub identity: Option<String>,
    pub tree: Vec<directory_tree::Entry>,
}
#[derive(Serialize)]
pub struct Issue {
    pub key: String,
    pub id: String,
    pub source: String,
    pub staging: String,
    pub target: String,
    pub message: String,
    pub cancellable: bool,
    pub retargetable: bool,
}
#[derive(Serialize)]
pub struct Preview {
    pub id: String,
    pub original: String,
    pub target: String,
    pub files: usize,
    pub folders: usize,
    pub bytes: u64,
    pub indexed: usize,
    pub conflict: bool,
    pub token: String,
}
fn location(root: &Path, path: &str, system: bool) -> Result<PathBuf, String> {
    if system {
        let path = library_files::normalize_relative(path)?;
        if !path.starts_with("trash/") && !path.starts_with("directory-staging/") {
            return Err("目录任务系统地址无效".into());
        }
        library_format::internal_path(root, &path)
    } else {
        library_files::checked_path(root, path)
    }
}
fn journal(root: &Path, key: &str) -> Result<PathBuf, String> {
    library_format::check_id(key)?;
    library_format::internal_path(root, &format!("directory-operations/{key}.json"))
}
fn save(root: &Path, op: &Operation) -> Result<(), String> {
    let path = journal(root, &op.key)?;
    fs::create_dir_all(path.parent().ok_or("任务目录无效")?).map_err(|e| e.to_string())?;
    write_json(&path, op)
}
fn read(path: &Path) -> Result<Operation, String> {
    let op: Operation = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("目录任务损坏：{e}"))?;
    if path.file_stem().and_then(|s| s.to_str()) != Some(op.key.as_str()) {
        return Err("目录任务标识不一致".into());
    }
    Ok(op)
}
pub fn pending(root: &Path) -> Result<Vec<PathBuf>, String> {
    let path = library_format::internal_path(root, "directory-operations")?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut entries = vec![];
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_some_and(|e| e == "json") {
            entries.push(path);
        }
    }
    entries.sort();
    Ok(entries)
}
pub fn ensure_clear(root: &Path) -> Result<(), String> {
    if !pending(root)?.is_empty() {
        return Err("存在未完成的收藏集任务，请先到管理收藏集面板处理".into());
    }
    Ok(())
}
fn archive(root: &Path, op: &Operation) -> Result<(), String> {
    let path = library_format::internal_path(
        root,
        &format!("directory-operations/completed/{}.json", op.key),
    )?;
    fs::create_dir_all(path.parent().ok_or("任务目录无效")?).map_err(|e| e.to_string())?;
    library_files::rename_no_replace(&journal(root, &op.key)?, &path)
}
fn check_tree(path: &Path, op: &Operation) -> Result<(), String> {
    if crate::file_observation::identity(path) != op.identity
        || directory_tree::snapshot(path)? != op.tree
    {
        return Err("目录内容在任务期间改变，保留现场，请核对后恢复".into());
    }
    Ok(())
}
fn precondition(root: &Path, op: &Operation) -> bool {
    let Ok(conn) = store::open(root) else {
        return false;
    };
    conn.query_row(
        "select path,deleted_seq from collections where id=?1",
        [&op.id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?)),
    )
    .is_ok_and(|(path, deleted)| {
        path == op.original
            && (if op.kind == "restore" {
                deleted.is_some()
            } else {
                deleted.is_none()
            })
    })
}
pub fn execute(root: &Path, op: &mut Operation) -> Result<(), String> {
    if !["trash", "restore", "move"].contains(&op.kind.as_str()) {
        return Err("未知目录任务类型".into());
    }
    if op.phase == "completed" || op.phase == "cancelled" {
        return archive(root, op);
    }
    let source = location(root, &op.source, op.kind == "restore")?;
    let target = location(root, &op.target, op.kind == "trash")?;
    let staging = location(root, &format!("directory-staging/{}", op.key), true)?;
    if source.exists() {
        let same = target.exists() && source.canonicalize().ok() == target.canonicalize().ok();
        if staging.exists() || (target.exists() && !same) {
            return Err("源或暂存与目标同时存在，未覆盖目录".into());
        }
        if !precondition(root, op) {
            return Err("收藏集状态已经改变，未继续移动".into());
        }
        check_tree(&source, op)?;
        fs::create_dir_all(staging.parent().ok_or("暂存位置无效")?).map_err(|e| e.to_string())?;
        library_files::rename_no_replace(&source, &staging)?;
        op.phase = "staged".into();
        save(root, op)?;
    }
    if staging.exists() {
        if target.exists() {
            return Err("目标已被占用，暂存原件保留，可另选恢复位置".into());
        }
        check_tree(&staging, op)?;
        fs::create_dir_all(target.parent().ok_or("目标位置无效")?).map_err(|e| e.to_string())?;
        location(root, &op.target, op.kind == "trash")?;
        library_files::rename_no_replace(&staging, &target)?;
        op.phase = "moved".into();
        save(root, op)?;
    }
    if !target.is_dir() {
        return Err("源、暂存或目标目录不可用，保留任务记录".into());
    }
    check_tree(&target, op)?;
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let row = tx
        .query_row(
            "select path,deleted_seq from collections where id=?1",
            [&op.id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if op.kind == "trash" {
        let key = format!("ceas.directory-trash.{}", op.id);
        if row.1.is_none() {
            if row.0 != op.original {
                return Err("收藏集位置改变，未提交回收".into());
            }
            let seq:i64=tx.query_row("update store_state set value=cast(value as integer)+1 where key='sequence' returning cast(value as integer)",[],|r|r.get(0)).map_err(|e|e.to_string())?;
            tx.execute(
                "update collections set deleted_seq=?1 where id=?2",
                params![seq, op.id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            let old: Option<String> = tx
                .query_row("select value from store_state where key=?1", [&key], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(|e| e.to_string())?;
            if !old
                .and_then(|v| serde_json::from_str::<Operation>(&v).ok())
                .is_some_and(|old| old.key == op.key)
            {
                return Err("收藏集已由其他任务回收".into());
            }
        }
        crate::file_reconcile::put_state(
            &tx,
            &key,
            &serde_json::to_string(op).map_err(|e| e.to_string())?,
        )?;
    } else {
        if row.0 != op.original && row.0 != op.target {
            return Err("收藏集位置版本改变，保留任务".into());
        }
        if row.0 != op.target {
            collection_store::relocate(&tx, &op.id, &op.original, &op.target)?;
        }
        tx.execute(
            "update collections set deleted_seq=null,state='ready',identity=?1 where id=?2",
            params![crate::file_observation::identity(&target), op.id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "delete from store_state where key=?1",
            [format!("ceas.directory-trash.{}", op.id)],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    op.phase = "completed".into();
    save(root, op)?;
    archive(root, op)
}
pub fn issues(root: &Path, retry: bool) -> Result<Vec<Issue>, String> {
    let mut issues = vec![];
    for path in pending(root)? {
        let key = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        match read(&path) {
            Ok(mut op) => {
                let error = if retry {
                    execute(root, &mut op).err()
                } else {
                    Some("收藏集任务尚未完成".into())
                };
                if let Some(message) = error {
                    let source = location(root, &op.source, op.kind == "restore").ok();
                    let staging = location(root, &format!("directory-staging/{}", op.key), true)?;
                    let target = location(root, &op.target, op.kind == "trash").ok();
                    let cancellable = source.as_ref().is_some_and(|p| p.is_dir())
                        && !staging.exists()
                        && target.is_some_and(|p| !p.exists())
                        && precondition(root, &op);
                    let retargetable = op.kind != "trash"
                        && (source.is_some_and(|p| p.is_dir()) || staging.is_dir())
                        && precondition(root, &op);
                    issues.push(Issue {
                        key: op.key,
                        id: op.id,
                        source: op.source,
                        staging: format!(".ceas/directory-staging/{}", key),
                        target: op.target,
                        message,
                        cancellable,
                        retargetable,
                    });
                }
            }
            Err(message) => issues.push(Issue {
                key,
                id: String::new(),
                source: String::new(),
                staging: String::new(),
                target: String::new(),
                message,
                cancellable: false,
                retargetable: false,
            }),
        }
    }
    Ok(issues)
}
fn trashed(root: &Path, id: &str) -> Result<Operation, String> {
    serde_json::from_str(
        store::state(root)?
            .get(&format!("ceas.directory-trash.{id}"))
            .ok_or("没有收藏集回收记录")?,
    )
    .map_err(|e| e.to_string())
}
pub fn preview(
    root: &Path,
    id: &str,
    kind: &str,
    target: Option<&str>,
) -> Result<(Preview, Operation), String> {
    if !["trash", "restore", "move"].contains(&kind) {
        return Err("目录操作无效".into());
    }
    ensure_clear(root)?;
    if !crate::file_operations::issues(root, false)?.is_empty() {
        return Err("请先处理未完成的素材文件任务".into());
    }
    let row = collection_store::list(root, kind == "restore")?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or("收藏集不存在、已回收或被祖先回收")?;
    let (source, tree) = if kind == "restore" {
        let old = trashed(root, id)?;
        (old.target, old.tree)
    } else {
        let directory = library_files::checked_path(root, &row.path)?;
        (row.path.clone(), directory_tree::snapshot(&directory)?)
    };
    let requested = target.unwrap_or(&row.path);
    library_files::normalize_relative(requested)?;
    if kind != "trash"
        && requested
            .to_lowercase()
            .starts_with(&format!("{}/", row.path.to_lowercase()))
    {
        return Err("不能移入自己或后代目录".into());
    }
    let target = if kind == "trash" {
        row.path.clone()
    } else if kind == "move" && requested.to_lowercase() == row.path.to_lowercase() {
        requested.into()
    } else {
        available_target(root, requested, &row.id)?
    };
    if kind == "move" && target != requested {
        return Err("目标已存在，请选择其他位置；不会合并文件夹".into());
    }
    let conn = store::open(root)?;
    let indexed:i64=conn.query_row("with recursive subtree(id) as (select ?1 union all select c.id from collections c join subtree s on c.parent_id=s.id where c.deleted_seq is null) select count(*) from items where collection_id in subtree and deleted_seq is null",[id],|r|r.get(0)).map_err(|e|e.to_string())?;
    let identity = crate::file_observation::identity(&location(root, &source, kind == "restore")?);
    let preview = Preview {
        id: id.into(),
        original: row.path.clone(),
        target: target.clone(),
        files: tree.iter().filter(|e| e.kind == "file").count(),
        folders: tree.iter().filter(|e| e.kind == "directory").count() + 1,
        bytes: tree.iter().map(|e| e.size).sum(),
        indexed: indexed as usize,
        conflict: target != requested,
        token: crate::file_hash::bytes(
            &serde_json::to_vec(&(&identity, &tree)).map_err(|e| e.to_string())?,
        )?,
    };
    Ok((
        preview,
        Operation {
            key: String::new(),
            id: id.into(),
            kind: kind.into(),
            original: row.path,
            source,
            target,
            phase: "prepared".into(),
            identity,
            tree,
        },
    ))
}
pub fn begin(
    root: &Path,
    id: &str,
    kind: &str,
    target: Option<&str>,
    task: &str,
    expected: &str,
    token: &str,
) -> Result<(), String> {
    library_format::check_id(task)?;
    if !["trash", "restore", "move"].contains(&kind) {
        return Err("目录操作无效".into());
    }
    let (preview, mut op) = preview(root, id, kind, target)?;
    if preview.original != expected
        || preview.token != token
        || (kind != "trash" && target.is_some_and(|target| target != preview.target))
    {
        return Err("收藏集在预览后移动，请重新预览".into());
    }
    op.key = task.into();
    if kind == "trash" {
        op.target = format!("trash/{task}/{}", op.original);
    }
    if journal(root, task)?.exists()
        || library_format::internal_path(
            root,
            &format!("directory-operations/completed/{task}.json"),
        )?
        .exists()
    {
        return Err("目录任务标识已使用".into());
    }
    save(root, &op)?;
    execute(root, &mut op)
}
pub fn cancel(root: &Path, key: &str) -> Result<(), String> {
    let can = issues(root, false)?
        .iter()
        .any(|i| i.key == key && i.cancellable);
    if !can {
        return Err("目录已经移动或存在冲突，不能取消".into());
    }
    let mut op = read(&journal(root, key)?)?;
    op.phase = "cancelled".into();
    save(root, &op)?;
    archive(root, &op)
}
pub fn retarget(
    root: &Path,
    key: &str,
    target: &str,
    parents: &[collection_store::Draft],
) -> Result<(), String> {
    if !issues(root, false)?
        .iter()
        .any(|i| i.key == key && i.retargetable)
    {
        return Err("此任务不能修改恢复位置".into());
    }
    let mut op = read(&journal(root, key)?)?;
    if target.to_lowercase() == op.original.to_lowercase()
        || target
            .to_lowercase()
            .starts_with(&format!("{}/", op.original.to_lowercase()))
    {
        return Err("请选择其他库内位置".into());
    }
    op.target = available_target(root, target, &op.id)?;
    if let Some((parent, _)) = op.target.rsplit_once('/') {
        let path = library_files::checked_path(root, parent)?;
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        library_files::checked_path(root, parent)?;
    }
    collection_store::ensure_for_task(root, parents)?;
    save(root, &op)?;
    execute(root, &mut op)
}

fn available_target(root: &Path, requested: &str, id: &str) -> Result<String, String> {
    library_files::normalize_relative(requested)?;
    let conn = store::open(root)?;
    for n in 0..10000 {
        let candidate = if n == 0 {
            requested.into()
        } else {
            format!("{requested} (恢复 {n})")
        };
        let occupied:bool=conn.query_row("select exists(select 1 from v_collections_visible where lower(path)=lower(?1) and id<>?2)",params![candidate,id],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !occupied && !library_files::checked_path(root, &candidate)?.exists() {
            return Ok(candidate);
        }
    }
    Err("恢复名称冲突过多，请另选位置".into())
}
