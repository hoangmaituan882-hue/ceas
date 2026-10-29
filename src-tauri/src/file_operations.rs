use crate::{file_reconcile, library_files, library_format, library_registry::write_json, store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Operation {
    pub key: String,
    pub kind: String,
    pub id: String,
    pub hash: String,
    pub original: String,
    pub source: String,
    pub target: String,
    pub source_system: bool,
    pub target_system: bool,
    pub phase: String,
}
#[derive(Serialize)]
pub struct Issue {
    pub id: String,
    pub kind: String,
    pub key: String,
    pub source: String,
    pub target: String,
    pub message: String,
    pub cancellable: bool,
    pub retargetable: bool,
}
pub fn location(root: &Path, relative: &str, system: bool) -> Result<PathBuf, String> {
    if system {
        let relative = library_files::normalize_relative(relative)?;
        if !relative.starts_with("trash/") {
            return Err("回收地址不在库内回收区".into());
        }
        library_format::internal_path(root, &relative)
    } else {
        library_files::checked_path(root, relative)
    }
}
fn journal(root: &Path, key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("文件任务标识无效".into());
    }
    library_format::internal_path(root, &format!("file-operations/{key}.json"))
}
pub fn pending(root: &Path) -> Result<Vec<PathBuf>, String> {
    let directory = library_format::internal_path(root, "file-operations")?;
    if !directory.exists() {
        return Ok(vec![]);
    }
    let mut paths = vec![];
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_some_and(|e| e == "json") {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}
pub fn read(path: &Path) -> Result<Operation, String> {
    let op: Operation = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("操作记录损坏：{e}"))?;
    if path.file_stem().and_then(|s| s.to_str()) != Some(&op.key) {
        return Err("操作记录身份与文件名不一致".into());
    }
    Ok(op)
}
pub fn save(root: &Path, op: &Operation) -> Result<(), String> {
    let path = journal(root, &op.key)?;
    fs::create_dir_all(path.parent().ok_or("任务没有父目录")?).map_err(|e| e.to_string())?;
    journal(root, &op.key)?;
    write_json(&path, op)
}
fn archive(root: &Path, op: &Operation) -> Result<(), String> {
    let completed = library_format::internal_path(root, "file-operations/completed")?;
    fs::create_dir_all(&completed).map_err(|e| e.to_string())?;
    let target =
        library_format::internal_path(root, &format!("file-operations/completed/{}.json", op.key))?;
    library_files::rename_no_replace(&journal(root, &op.key)?, &target)
}
fn commit(root: &Path, op: &Operation) -> Result<(), String> {
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let row: Option<(String, Option<String>, Option<i64>)> = tx
        .query_row(
            "select hash,relative_path,deleted_seq from items where id=?1",
            [&op.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (hash, path, deleted) = row.ok_or("素材记录已不存在，保留操作记录")?;
    if hash != op.hash {
        return Err("素材内容版本改变，保留两处文件供核对".into());
    }
    if op.kind == "trash" {
        if deleted.is_none() {
            if path.as_deref() != Some(&op.original) {
                return Err("素材地址已改变，不能提交回收".into());
            }
            let seq:i64=tx.query_row("update store_state set value=cast(value as integer)+1 where key='sequence' returning cast(value as integer)",[],|r|r.get(0)).map_err(|e|e.to_string())?;
            tx.execute(
                "update items set deleted_seq=?1,relative_path=null where id=?2",
                params![seq, op.id],
            )
            .map_err(|e| e.to_string())?;
        }
        file_reconcile::put_state(
            &tx,
            &format!("ceas.trash.{}", op.id),
            &serde_json::to_string(op).map_err(|e| e.to_string())?,
        )?;
    } else {
        if op.kind == "restore" && deleted.is_none() && path.as_deref() != Some(&op.target) {
            return Err("素材已经在其他位置恢复，未重复修改".into());
        }
        if op.kind == "move"
            && path.as_deref() != Some(&op.original)
            && path.as_deref() != Some(&op.target)
        {
            return Err("素材地址已改变，不能提交移动".into());
        }
        tx.execute("update items set relative_path=?1,name=?2,collection_id=?4,deleted_seq=null,deleted_at=null where id=?3",params![op.target,op.target.rsplit('/').next().unwrap_or(""),op.id,crate::collection_store::parent(&tx,&op.target)?]).map_err(|e|e.to_string())?;
        tx.execute(
            "delete from store_state where key=?1",
            [format!("ceas.trash.{}", op.id)],
        )
        .map_err(|e| e.to_string())?;
        file_reconcile::source_paths(&tx, &op.id, &op.target)?;
        if let Some((key, value)) = crate::file_observation::record(root, &op.id, &op.target) {
            file_reconcile::put_state(&tx, &key, &value)?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}
pub fn execute(root: &Path, op: &mut Operation) -> Result<(), String> {
    crate::directory_operations::ensure_clear(root)?;
    if !["trash", "restore", "move"].contains(&op.kind.as_str()) {
        return Err("未知文件操作".into());
    }
    if (op.kind == "trash" && (!op.target_system || op.source_system))
        || (op.kind == "restore" && (!op.source_system || op.target_system))
        || (op.kind == "move" && (op.source_system || op.target_system))
    {
        return Err("操作记录的文件区域不正确".into());
    }
    if op.phase == "completed" || op.phase == "cancelled" {
        return archive(root, op);
    }
    let source = location(root, &op.source, op.source_system)?;
    let target = location(root, &op.target, op.target_system)?;
    if source.exists() && target.exists() {
        return Err("源和目标同时存在，未覆盖或自动删除任何文件，请处理冲突后重试".into());
    }
    let existing = if source.is_file() {
        &source
    } else if target.is_file() {
        &target
    } else {
        return Err("源和目标原件均不可用，保留元数据与操作记录".into());
    };
    if crate::file_observation::is_link(existing)? || crate::file_hash::file(existing)? != op.hash {
        return Err("原件在操作期间发生变化，未继续移动；请核对或取消未移动的任务".into());
    }
    if source.is_file() {
        fs::create_dir_all(target.parent().ok_or("目标没有父目录")?).map_err(|e| e.to_string())?;
        location(root, &op.target, op.target_system)?;
        library_files::rename_no_replace(&source, &target)?;
    }
    op.phase = "moved".into();
    save(root, op)?;
    if crate::file_hash::file(&target)? != op.hash {
        return Err("移动后校验失败，原件位置已记录，请重试核对".into());
    }
    commit(root, op)?;
    op.phase = "completed".into();
    save(root, op)?;
    archive(root, op)
}
pub fn issues(root: &Path, retry: bool) -> Result<Vec<Issue>, String> {
    let mut result = vec![];
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
                    Some("上次文件操作未完成".into())
                };
                if let Some(message) = error {
                    let cancellable = can_cancel(root, &op);
                    let retargetable =
                        op.kind != "trash" && op.phase == "prepared" && precondition(root, &op);
                    result.push(Issue {
                        id: op.id,
                        kind: op.kind,
                        key: op.key,
                        source: op.source,
                        target: op.target,
                        message,
                        cancellable,
                        retargetable,
                    });
                }
            }
            Err(message) => result.push(Issue {
                id: String::new(),
                kind: String::new(),
                key,
                source: String::new(),
                target: String::new(),
                message,
                cancellable: false,
                retargetable: false,
            }),
        }
    }
    Ok(result)
}
pub fn cancel(root: &Path, key: &str) -> Result<(), String> {
    let mut op = read(&journal(root, key)?)?;
    if !can_cancel(root, &op) {
        return Err("文件已移动或位置有歧义，不能取消，请先恢复任务".into());
    }
    op.phase = "cancelled".into();
    save(root, &op)?;
    archive(root, &op)
}
fn can_cancel(root: &Path, op: &Operation) -> bool {
    if op.phase == "completed"
        || !location(root, &op.source, op.source_system).is_ok_and(|p| p.is_file())
        || !location(root, &op.target, op.target_system).is_ok_and(|p| !p.exists())
    {
        return false;
    }
    precondition(root, op)
}
fn precondition(root: &Path, op: &Operation) -> bool {
    if !location(root, &op.source, op.source_system).is_ok_and(|p| p.is_file()) {
        return false;
    }
    let Ok(conn) = store::open(root) else {
        return false;
    };
    let row: Result<(Option<String>, Option<i64>), _> = conn.query_row(
        "select relative_path,deleted_seq from items where id=?1",
        [&op.id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    );
    row.is_ok_and(|(path, deleted)| {
        if op.kind == "restore" {
            deleted.is_some()
        } else {
            deleted.is_none() && path.as_deref() == Some(&op.original)
        }
    })
}
pub fn retarget(root: &Path, key: &str, target: &str) -> Result<(), String> {
    let mut op = read(&journal(root, key)?)?;
    if op.kind == "trash" || op.phase != "prepared" || !precondition(root, &op) {
        return Err("此任务已移动或原状态改变，不能修改恢复位置".into());
    }
    op.target = crate::file_trash::available_target(root, target)?;
    save(root, &op)?;
    execute(root, &mut op)
}
pub fn ensure_clear(root: &Path, id: &str) -> Result<(), String> {
    for path in pending(root)? {
        if read(&path)?.id == id {
            return Err("此素材有待恢复的文件操作，请在文件核对面板处理".into());
        }
    }
    Ok(())
}
