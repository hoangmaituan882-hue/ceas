use crate::{
    file_observation::{self, Record},
    library_scan::Entry,
    store,
};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::Deserialize;
use std::{collections::HashSet, path::Path};
#[derive(Deserialize)]
pub struct Match {
    pub id: String,
    pub previous: String,
    pub hash: String,
    pub content_hash: String,
    pub entry: Entry,
}
pub fn put_state(tx: &Transaction<'_>, key: &str, value: &str) -> Result<usize, String> {
    tx.execute("insert into store_state values(?1,?2) on conflict(key) do update set value=excluded.value where store_state.value<>excluded.value",params![key,value]).map_err(|e|e.to_string())
}
pub fn source_paths(tx: &Transaction<'_>, id: &str, path: &str) -> Result<(), String> {
    tx.execute("update store_state set value=?1 where key in (select 'ceas.import-path.'||substr(key,16) from store_state where key like 'ceas.import-id.%' and value=?2)",params![path,id]).map_err(|e|e.to_string())?;
    Ok(())
}
fn read_record(tx: &Transaction<'_>, id: &str) -> Result<Option<Record>, String> {
    let value: Option<String> = tx
        .query_row(
            "select value from store_state where key=?1",
            [format!("ceas.file.{id}")],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(value.and_then(|s| serde_json::from_str(&s).ok()))
}
/// 一次核对的结算结果。
///
/// `blocked` 不为 0 表示「消失项太多，先别自动回收」：调用方要拿这个数字去问用户，
/// 确认后用 `adopt=true` 重跑一次。**这是防拔盘/断连清库的唯一闸门**，不能省。
#[derive(serde::Serialize, Default, Debug, PartialEq)]
pub struct Outcome {
    pub changed: usize,
    pub trashed: usize,
    pub blocked: usize,
}

/// 毫秒时间戳：回收时间只用于展示与排序，不参与判定。
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 批量消失的确认阈值。
///
/// 两条并列，够一条就要确认：
/// 1. 一次消失超过 20 项（绝对量，小库也拦得住）；
/// 2. 库有 50 项以上、且消失超过 10%（相对量，大库里 21 项不算事，40 项就是事故）。
///
/// **为什么比例规则要加 50 项的门槛**：库里只有 3 张图时删掉 1 张就是 33%，
/// 若按比例一律拦，用户每次删图都要点一次确认 —— 那不是安全，那是骚扰。
fn needs_confirmation(missing: usize, visible: i64) -> bool {
    missing > 20 || (visible >= 50 && (missing as i64) * 10 > visible)
}

/// `adopt=false`：消失项只写状态，不动记录（除非确认过阈值）。
/// `adopt=true`：用户已确认「这些确实被删了」，跟随删除进回收站。
pub fn apply(
    root: &Path,
    matches: &[Match],
    missing: &[String],
    adopt: bool,
) -> Result<Outcome, String> {
    crate::directory_operations::ensure_clear(root)?;
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    for item in matches {
        if !ids.insert(&item.id) || !paths.insert(item.entry.rel_path.to_lowercase()) {
            return Err("核对清单有重复身份或目标路径".into());
        }
        let current: Option<(Option<String>, String)> = tx
            .query_row(
                "select relative_path,hash from v_items_visible where id=?1",
                [&item.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let current = current.map(|(path, hash)| {
            (
                path.or_else(|| read_record(&tx, &item.id).ok().flatten().map(|r| r.path)),
                hash,
            )
        });
        if current != Some((Some(item.previous.clone()), item.hash.clone())) {
            return Err("素材在核对期间发生变动，请重试".into());
        }
        let path = crate::library_files::checked_path(root, &item.entry.rel_path)?;
        if file_observation::is_link(&path)?
            || file_observation::inspect(&path)? != item.entry.observation
        {
            return Err("文件在核对期间发生变化，请重试".into());
        }
    }
    let mut absent = Vec::new();
    for id in missing {
        if ids.contains(id) {
            continue;
        }
        let path: Option<Option<String>> = tx
            .query_row(
                "select relative_path from v_items_visible where id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(path) = path {
            let record = read_record(&tx, id)?;
            if let Some(path) = path.or_else(|| record.as_ref().map(|r| r.path.clone())) {
                let displaced = paths.contains(&path.to_lowercase());
                if displaced {
                    tx.execute("update items set relative_path=null where id=?1", [id])
                        .map_err(|e| e.to_string())?;
                }
                absent.push((id, path, record, displaced));
            }
        }
    }
    // 改名交换和原地址被另一文件占用都不能吞掉旧对象。
    for item in matches {
        tx.execute(
            "update items set relative_path=null where id=?1",
            [&item.id],
        )
        .map_err(|e| e.to_string())?;
    }
    let mut changed = 0;
    for item in matches {
        tx.execute(
            "update items set relative_path=?1,name=?2,collection_id=?4 where id=?3",
            params![
                item.entry.rel_path,
                item.entry.name,
                item.id,
                crate::collection_store::parent(&tx, &item.entry.rel_path)?
            ],
        )
        .map_err(|e| e.to_string())?;
        source_paths(&tx, &item.id, &item.entry.rel_path)?;
        if item.previous != item.entry.rel_path {
            changed += 1;
        }
        let record = Record {
            path: item.entry.rel_path.clone(),
            state: if item.hash == item.content_hash {
                "ready"
            } else {
                "pending"
            }
            .into(),
            observation: item.entry.observation.clone(),
        };
        changed += put_state(
            &tx,
            &format!("ceas.file.{}", item.id),
            &serde_json::to_string(&record).map_err(|e| e.to_string())?,
        )?;
    }
    /* ── 消失项：先分「确认不存在」与「只是读不到」，再决定是否跟随删除 ──
    只有 NotFound（含被别的文件顶替地址）才算删除；不可读、权限、盘没插一律只写状态。
    这是 ADR 0008 的安全边界，顺序不能反。 */
    let visible: i64 = tx
        .query_row("select count(*) from v_items_visible", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut trashed_candidates = Vec::new();
    for (id, path, old, displaced) in absent {
        let status = if displaced {
            "missing"
        } else {
            match crate::library_files::checked_path(root, &path) {
                Err(_) => "unreadable",
                Ok(file) => match std::fs::metadata(file) {
                    Ok(meta) if meta.is_file() => continue,
                    Ok(_) => "unreadable",
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => "missing",
                    Err(_) => "unreadable",
                },
            }
        };
        let key = format!("ceas.file.{id}");
        let mut record = old.unwrap_or(Record {
            path: path.clone(),
            state: status.into(),
            observation: Default::default(),
        });
        record.state = status.into();
        changed += put_state(
            &tx,
            &key,
            &serde_json::to_string(&record).map_err(|e| e.to_string())?,
        )?;
        if status == "missing" {
            trashed_candidates.push((id, path));
        }
    }
    let blocked = if adopt || !needs_confirmation(trashed_candidates.len(), visible) {
        0
    } else {
        trashed_candidates.len()
    };
    let mut trashed = 0;
    if blocked == 0 {
        for (id, _) in trashed_candidates {
            /* 与「应用内回收」同形：递增序号 + 清地址。区别只在于原件已经不在盘上，
            所以回收区里没有它的文件，恢复时只能重新指认（见 09「两种来源」）。 */
            let seq: i64 = tx
                .query_row(
                    "update store_state set value=cast(value as integer)+1 where key='sequence' returning cast(value as integer)",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            tx.execute(
                "update items set deleted_seq=?1,deleted_at=?2,relative_path=null where id=?3 and deleted_seq is null",
                params![seq, now_ms(), id],
            )
            .map_err(|e| e.to_string())?;
            trashed += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Outcome {
        changed,
        trashed,
        blocked,
    })
}

/// 记录状态由调用方改写：`decode` 表示「字节读到了，但内容解不开」。
///
/// 为什么要单独一个状态：`pending` 是**过程**（下一步就会更新完），`unreadable` 是
/// **读不到**（权限、IO、被换成目录），而「文件在、内容坏了」是第三种事实。
/// 混进任何一个旧状态，用户都会看到一个说不清楚、且不会自己好的提示。
const MARKABLE: [&str; 3] = ["pending", "unreadable", "decode"];

pub fn mark_state(root: &Path, id: &str, state: &str) -> Result<(), String> {
    if !MARKABLE.contains(&state) {
        return Err("不支持的文件记录状态".into());
    }
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut record = read_record(&tx, id)?.ok_or("没有找到该素材的文件记录")?;
    record.state = state.into();
    put_state(
        &tx,
        &format!("ceas.file.{id}"),
        &serde_json::to_string(&record).map_err(|e| e.to_string())?,
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 「按普通文件保留」的结算结果。
#[derive(serde::Serialize, Default, Debug, PartialEq)]
pub struct Accepted {
    pub hash: String,
    /// 内容确实变了（哈希重算过）；同内容重试为 false。
    pub changed: bool,
}

/// 接受磁盘上的当前字节：哈希按文件重算，类型降级为普通文件，记录转 `ready`。
///
/// 给的是**出口**而不是重试：一张图被改成损坏字节后，缩略图永远生成不出来，
/// 但文件本身还在、还占空间、用户可能就是想留着它。此前的选择只有「反复重试」，
/// 那是把实现的失败甩给用户。降级为普通文件后，它仍可被看到、被定位、被删掉。
pub fn accept_content(root: &Path, id: &str) -> Result<Accepted, String> {
    crate::directory_operations::ensure_clear(root)?;
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let row: Option<(Option<String>, String)> = tx
        .query_row(
            "select relative_path,hash from v_items_visible where id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (relative, previous) = match row {
        Some((Some(relative), hash)) => (relative, hash),
        // 没有地址就没有可接受的原件；这种条目只能走重新关联。
        Some((None, _)) => return Err("素材没有原件地址，无法接受当前内容".into()),
        None => return Err("素材不在库里或已被回收".into()),
    };
    let file = crate::library_files::checked_path(root, &relative)?;
    if file_observation::is_link(&file)? {
        return Err("原件是路径链接，未接受".into());
    }
    let observation = file_observation::inspect(&file)?;
    let hash = crate::file_hash::file(&file)?;
    let changed = hash != previous;
    if changed {
        /* 解不开的内容不可能有真实的尺寸/调色板，降级成普通文件；
        旧缩略图不再匹配，但也不额外清空 —— kind 已经不是图片，界面不会展示它。 */
        tx.execute(
            "update items set hash=?1,bytes=?2,kind='file',duration=null where id=?3",
            params![hash, observation.size as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    let record = Record {
        path: relative,
        state: "ready".into(),
        observation,
    };
    put_state(
        &tx,
        &format!("ceas.file.{id}"),
        &serde_json::to_string(&record).map_err(|e| e.to_string())?,
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Accepted { hash, changed })
}

/// 文件回到原样：清掉墓碑并恢复地址。
///
/// 与「重复导入不复活墓碑」不冲突 —— 那条防的是同一个 id 被重复写入，
/// 这里是**磁盘事实真的回到了原路径**（撤销删除、移动盘插回）。人工信息原样保留。
pub fn revive(root: &Path, id: &str, path: &str) -> Result<(), String> {
    let mut conn = store::open(root)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let deleted: Option<Option<i64>> = tx
        .query_row("select deleted_seq from items where id=?1", [id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(deleted) = deleted else {
        return Err("素材记录已不存在".into());
    };
    if deleted.is_none() {
        return Ok(());
    }
    tx.execute(
        "update items set deleted_seq=null,deleted_at=null,relative_path=?1,name=?2,collection_id=?3 where id=?4",
        params![
            path,
            path.rsplit('/').next().unwrap_or(path),
            crate::collection_store::parent(&tx, path)?,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    if let Some((key, value)) = crate::file_observation::record(root, id, path) {
        put_state(&tx, &key, &value)?;
    }
    tx.execute(
        "delete from store_state where key=?1",
        [format!("ceas.trash.{id}")],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
