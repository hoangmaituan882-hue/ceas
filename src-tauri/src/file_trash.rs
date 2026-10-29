use crate::{
    file_operations::{self, Operation},
    library_files, library_format, store,
};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::{collections::HashSet, path::Path};
#[derive(Serialize)]
pub struct Preview {
    pub id: String,
    pub original: String,
    pub target: String,
    pub conflict: bool,
    pub available: bool,
}
fn stored(root: &Path, id: &str) -> Result<Operation, String> {
    let states = store::state(root)?;
    serde_json::from_str(
        states
            .get(&format!("ceas.trash.{id}"))
            .ok_or("此条记录没有原件回收地址，请检查资料库")?,
    )
    .map_err(|e| format!("回收记录损坏：{e}"))
}
pub fn available_target(root: &Path, requested: &str) -> Result<String, String> {
    choose_target(root, requested, &HashSet::new())
}
fn choose_target(
    root: &Path,
    requested: &str,
    reserved: &HashSet<String>,
) -> Result<String, String> {
    let requested = library_files::normalize_relative(requested)?;
    let target = library_files::checked_path(root, &requested)?;
    if !target.exists() && !reserved.contains(&requested.to_lowercase()) {
        return Ok(requested);
    }
    let stem = target.file_stem().unwrap_or_default().to_string_lossy();
    let ext = target
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    let parent = requested
        .rsplit_once('/')
        .map(|(parent, _)| format!("{parent}/"))
        .unwrap_or_default();
    for n in 1..10000 {
        let candidate = format!("{parent}{stem} (恢复 {n}){ext}");
        if !library_files::checked_path(root, &candidate)?.exists()
            && !reserved.contains(&candidate.to_lowercase())
        {
            return Ok(candidate);
        }
    }
    Err("可用恢复名称过多，请选择其他收藏集".into())
}
fn begin(root: &Path, op: &mut Operation) -> Result<(), String> {
    let completed =
        library_format::internal_path(root, &format!("file-operations/completed/{}.json", op.key))?;
    if completed.exists() {
        let old = file_operations::read(&completed)?;
        if old.id == op.id && old.kind == op.kind && old.phase == "completed" {
            *op = old;
            return Ok(());
        }
        return Err("任务标识已经被使用，请重新提交".into());
    }
    file_operations::ensure_clear(root, &op.id)?;
    file_operations::save(root, op)?;
    file_operations::execute(root, op)
}
pub fn delete(root: &Path, ids: &[String], task: &str) -> Result<usize, String> {
    crate::directory_operations::ensure_clear(root)?;
    library_format::check_id(task)?;
    let rows = store::list(root, 0)?;
    let mut operations = vec![];
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            continue;
        }
        let Some(row) = rows.iter().find(|r| r.id == *id) else {
            continue;
        };
        file_operations::ensure_clear(root, id)?;
        let original = row
            .relative_path
            .as_deref()
            .ok_or("原件地址缺失，请先进行文件核对")?;
        let source = library_files::checked_path(root, original)?;
        if !source.is_file() {
            return Err(format!("原件缺失或不可读，未回收：{original}"));
        }
        if crate::file_hash::file(&source)? != row.hash {
            return Err(format!("原件已变化，请先重新核对：{original}"));
        }
        operations.push(Operation {
            key: format!("{task}-{:x}", operations.len()),
            kind: "trash".into(),
            id: id.clone(),
            hash: row.hash.clone(),
            original: original.into(),
            source: original.into(),
            target: format!("trash/{task}/{original}"),
            source_system: false,
            target_system: true,
            phase: "prepared".into(),
        });
    }
    let mut changed = 0;
    for mut op in operations {
        begin(root, &mut op).map_err(|e| {
            format!("已回收 {changed} 项；未完成项保留记录，请到文件核对面板处理：{e}")
        })?;
        changed += 1;
    }
    Ok(changed)
}
pub fn preview(root: &Path, ids: &[String], folder: Option<&str>) -> Result<Vec<Preview>, String> {
    let folder = folder
        .filter(|s| !s.is_empty())
        .map(library_files::normalize_relative)
        .transpose()?;
    let mut result = vec![];
    let mut reserved = HashSet::new();
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            continue;
        }
        let op = stored(root, id)?;
        let requested = folder
            .as_ref()
            .map(|folder| format!("{folder}/{}", op.original.rsplit('/').next().unwrap_or("")))
            .unwrap_or(op.original.clone());
        let target = choose_target(root, &requested, &reserved)?;
        let conflict = target != requested;
        reserved.insert(target.to_lowercase());
        result.push(Preview {
            id: id.clone(),
            original: op.original,
            target,
            conflict,
            available: file_operations::location(root, &op.target, true)?.is_file(),
        });
    }
    Ok(result)
}
pub fn restore(
    root: &Path,
    ids: &[String],
    task: &str,
    folder: Option<&str>,
) -> Result<usize, String> {
    crate::directory_operations::ensure_clear(root)?;
    library_format::check_id(task)?;
    let deleted = store::list_trash(root)?;
    let ids: Vec<String> = ids
        .iter()
        .filter(|id| deleted.iter().any(|r| r.id == **id))
        .cloned()
        .collect();
    let previews = preview(root, &ids, folder)?;
    if previews.iter().any(|p| !p.available) {
        return Err("部分回收原件不可用，请先检查回收区；未开始恢复".into());
    }
    let mut count = 0;
    let mut seen = HashSet::new();
    for row in previews {
        if !seen.insert(row.id.clone()) {
            continue;
        }
        let old = stored(root, &row.id)?;
        let target = available_target(root, &row.target)?;
        let mut op = Operation {
            key: format!("{task}-{count:x}"),
            kind: "restore".into(),
            id: row.id,
            hash: old.hash,
            original: old.original,
            source: old.target,
            target,
            source_system: true,
            target_system: false,
            phase: "prepared".into(),
        };
        begin(root, &mut op).map_err(|e| format!("已恢复 {count} 项；未完成项保留记录：{e}"))?;
        count += 1;
    }
    Ok(count)
}
pub fn move_item(root: &Path, id: &str, relative: &str, task: &str) -> Result<String, String> {
    crate::directory_operations::ensure_clear(root)?;
    library_format::check_id(task)?;
    let row = store::list(root, 0)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("素材不存在或已回收")?;
    let original = row.relative_path.ok_or("原件地址缺失")?;
    if original == relative {
        return Ok(original);
    }
    let target = available_target(root, relative)?;
    let mut op = Operation {
        key: format!("{task}-0"),
        kind: "move".into(),
        id: id.into(),
        hash: row.hash,
        original: original.clone(),
        source: original,
        target,
        source_system: false,
        target_system: false,
        phase: "prepared".into(),
    };
    begin(root, &mut op)?;
    Ok(op.target)
}
pub fn original(root: &Path, id: &str, relative: &str) -> Result<std::path::PathBuf, String> {
    let rows = store::list_trash(root)?;
    if rows.iter().any(|r| r.id == id) {
        let op = stored(root, id)?;
        return file_operations::location(root, &op.target, true);
    }
    library_files::checked_path(root, relative)
}

/// 彻底删除的结算：`bytes` 是**真的从磁盘释放**的字节数。
///
/// 「磁盘删除」类条目在回收区里没有原件，字节按 0 计 —— 不能报错，
/// 也不能把它算成释放了体积（那是在骗用户）。
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Purged {
    pub removed: usize,
    pub bytes: u64,
}

/// 彻底删除选中的回收项：先删原件，再删记录。
///
/// 顺序是有意的：删了记录再删文件，一旦文件删不掉就会留下孤儿字节且查不到是谁的。
pub fn purge(root: &Path, ids: &[String]) -> Result<Purged, String> {
    crate::directory_operations::ensure_clear(root)?;
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut result = Purged::default();
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            continue;
        }
        let deleted: Option<Option<i64>> = tx
            .query_row("select deleted_seq from items where id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        /* 只有回收站里的项能彻底删除；对可见项调用是调用方的错，直接跳过而不是删掉它。 */
        let Some(Some(_)) = deleted else { continue };
        let op: Option<String> = tx
            .query_row(
                "select value from store_state where key=?1",
                [format!("ceas.trash.{id}")],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(value) = op {
            let operation: Operation =
                serde_json::from_str(&value).map_err(|e| format!("回收记录损坏：{e}"))?;
            let file = file_operations::location(root, &operation.target, true)?;
            if file.is_file() {
                result.bytes += std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
                std::fs::remove_file(&file).map_err(|e| format!("删除回收原件失败：{e}"))?;
            }
        }
        tx.execute("delete from item_tags where item_id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute("delete from items where id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "delete from store_state where key in (?1,?2)",
            params![format!("ceas.trash.{id}"), format!("ceas.file.{id}")],
        )
        .map_err(|e| e.to_string())?;
        result.removed += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

/// 清空回收站：等价于对全部回收项逐个 `purge`。
pub fn empty(root: &Path) -> Result<Purged, String> {
    let ids = store::list_trash(root)?
        .into_iter()
        .map(|row| row.id)
        .collect::<Vec<_>>();
    purge(root, &ids)
}

/// 把一条回收记录的整理信息**合并**到库里另一份素材上，然后删掉这条记录。
///
/// 为什么不是"重新指认成这个文件"：原件已经不存在，内容哈希不可能对上；
/// 硬指过去等于让用户以为字节回来了。所以做成"整理信息搬家" —— 标签取并集、
/// 描述/来源/评分只在目标为空时补上，原记录随后清除。用户的心智是
/// "这张我还有另一版"，不是"文件复活了"。
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Merged {
    pub tags: usize,
}

pub fn merge_into(root: &Path, source: &str, target: &str) -> Result<Merged, String> {
    if source == target {
        return Err("不能合并到自己".into());
    }
    crate::directory_operations::ensure_clear(root)?;
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let source_deleted: Option<Option<i64>> = tx
        .query_row("select deleted_seq from items where id=?1", [source], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match source_deleted {
        None => return Err("要合并的回收记录已不存在".into()),
        Some(None) => return Err("只有回收站里的记录才能合并".into()),
        Some(Some(_)) => {}
    }
    let target_deleted: Option<Option<i64>> = tx
        .query_row("select deleted_seq from items where id=?1", [target], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match target_deleted {
        None => return Err("目标素材已不存在".into()),
        Some(Some(_)) => return Err("目标素材也在回收站里".into()),
        Some(None) => {}
    }

    /* 标签取并集；描述/来源/评分只补空，不覆盖目标上已经写好的内容。 */
    /* 嵌套 fn 而不是闭包：闭包返回借用 statement 的迭代器活不过函数体。 */
    fn read_tags(tx: &rusqlite::Transaction<'_>, id: &str) -> Result<Vec<String>, String> {
        let mut statement = tx
            .prepare("select tag from item_tags where item_id=?1 order by tag")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut tags = Vec::new();
        for row in rows {
            tags.push(row.map_err(|e| e.to_string())?);
        }
        Ok(tags)
    }
    let source_tags = read_tags(&tx, source)?;
    let target_tags = read_tags(&tx, target)?;
    let mut merged = target_tags.clone();
    for tag in &source_tags {
        if !merged.contains(tag) {
            merged.push(tag.clone());
        }
    }
    let added = merged.len() - target_tags.len();
    for tag in &merged {
        if target_tags.contains(tag) {
            continue;
        }
        tx.execute(
            "insert or ignore into item_tags values(?1,?2)",
            params![target, tag],
        )
        .map_err(|e| e.to_string())?;
    }

    let (source_description, source_url, source_rating, source_site, source_created): (
        String,
        String,
        u8,
        Option<String>,
        i64,
    ) = tx
        .query_row(
            "select description,source_url,rating,site,created_at from items where id=?1",
            [source],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| e.to_string())?;
    tx.execute(
        "update items set description=case when description='' then ?2 else description end,
             source_url=case when source_url='' then ?3 else source_url end,
             site=coalesce(site,?4), rating=max(rating,?5), created_at=min(created_at,?6)
         where id=?1",
        params![
            target,
            source_description,
            source_url,
            source_site,
            source_rating,
            source_created
        ],
    )
    .map_err(|e| e.to_string())?;

    /* 原记录彻底移除：回收区里的原件（如果有）一并删掉，不留孤儿字节。 */
    let op: Option<String> = tx
        .query_row(
            "select value from store_state where key=?1",
            [format!("ceas.trash.{source}")],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(value) = op {
        if let Ok(operation) = serde_json::from_str::<Operation>(&value) {
            let file = file_operations::location(root, &operation.target, true)?;
            if file.is_file() {
                std::fs::remove_file(&file).map_err(|e| format!("删除回收原件失败：{e}"))?;
            }
        }
    }
    tx.execute("delete from item_tags where item_id=?1", [source])
        .map_err(|e| e.to_string())?;
    tx.execute("delete from items where id=?1", [source])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "delete from store_state where key in (?1,?2)",
        params![
            format!("ceas.trash.{source}"),
            format!("ceas.file.{source}")
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Merged { tags: added })
}
