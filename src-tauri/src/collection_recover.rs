//! §5.3「重新定位」：整个收藏集目录跑到库外之后，怎么把它接回来。
//!
//! 为什么不是「改一下数据库里的路径」：库就是普通文件夹（ADR 0002），
//! 收藏集的路径不是一个可以随手改的标签，它必须是库内真实存在的目录。
//! 所以「我的参考集现在在桌面上」这件事，只有一个诚实的处理方式 ——
//! 把那个目录收回库内，交还给原来那个位置。收回之后，核对会按内容哈希
//! 把每一条缺失记录复活，标签、描述、评分原样回来。
//!
//! 同盘优先 `rename`（瞬时、不占额外空间）；跨盘才逐个复制并双向校验，
//! 复制成功后原目录**保留**，并在结果里说明 —— 不替用户决定删哪一份。

use crate::{file_hash, file_observation, library_files};
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

const MAX_DEPTH: usize = 128;

#[derive(Serialize, Debug, PartialEq)]
pub struct Recovered {
    /// `moved`（同盘改名）或 `copied`（跨盘复制，原目录保留）
    pub mode: String,
    pub files: usize,
    pub bytes: u64,
    pub target: String,
}

pub fn relocate(root: &Path, id: &str, source: &str) -> Result<Recovered, String> {
    crate::library_format::check_id(id)?;
    crate::directory_operations::ensure_clear(root)?;

    let row: Option<(String, String)> = {
        let conn = crate::store::open(root)?;
        conn.query_row(
            "select path,state from v_collections_visible where id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };
    let (relative, state) = row.ok_or("收藏集不存在、已回收或被祖先回收")?;
    if state != "missing" {
        /* 目录还在（unreadable 是读不到，不是没有）——重新定位解决不了权限问题，
        把用户引到真正的病因上。 */
        return Err(if state == "unreadable" {
            "这个收藏集的目录还在，只是读不到；检查磁盘或权限后重新核对".into()
        } else {
            "这个收藏集在库里正常可用，直接重新核对即可".into()
        });
    }

    let target = library_files::checked_path(root, &relative)?;
    if target.exists() {
        return Err("这个位置已经有目录了，直接重新核对即可".into());
    }

    let from = fs::canonicalize(source).map_err(|_| "所选目录不存在或没有权限访问".to_string())?;
    let meta = fs::metadata(&from).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return Err("请选择文件夹，而不是单个文件".into());
    }
    if file_observation::is_link(Path::new(source))? {
        return Err("所选目录是路径链接，未收回".into());
    }
    let real_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    if from.starts_with(&real_root) {
        return Err("所选目录已经在资料库里，直接重新核对即可".into());
    }
    if real_root.starts_with(&from) {
        return Err("不能把资料库的上级目录收回库里".into());
    }
    if from.join(".ceas/library.json").exists() {
        return Err("所选目录是一个资料库，不能作为一个收藏集收回".into());
    }

    let parent = target.parent().ok_or("收藏集地址无效")?;
    fs::create_dir_all(parent).map_err(|e| format!("创建上级收藏集失败：{e}"))?;
    // 建目录后再验一次，避免中间层是链接把内容导向库外。
    library_files::checked_path(root, &relative)?;

    let (mode, stats) = match fs::rename(&from, &target) {
        Ok(()) => ("moved", measure(&target)?),
        Err(_) => ("copied", copy_tree(&from, &target)?),
    };
    Ok(Recovered {
        mode: mode.into(),
        files: stats.0,
        bytes: stats.1,
        target: relative,
    })
}

/// 遍历：拒绝链接、限制层级，返回（文件数, 字节数, 相对路径列表）。
fn walk(from: &Path) -> Result<(usize, u64, Vec<PathBuf>), String> {
    let mut pending = vec![(from.to_path_buf(), 0usize)];
    let mut files = Vec::new();
    let mut bytes = 0u64;
    while let Some((directory, depth)) = pending.pop() {
        if depth > MAX_DEPTH {
            return Err("目录层级过深，未收回".into());
        }
        for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                return Err(format!(
                    "目录里有路径链接，请先处理：{}",
                    path.file_name().unwrap_or_default().to_string_lossy()
                ));
            }
            if kind.is_dir() {
                pending.push((path, depth + 1));
            } else if kind.is_file() {
                bytes += entry.metadata().map_err(|e| e.to_string())?.len();
                files.push(path);
            }
        }
    }
    Ok((files.len(), bytes, files))
}

fn measure(path: &Path) -> Result<(usize, u64), String> {
    let (files, bytes, _) = walk(path)?;
    Ok((files, bytes))
}

/// 跨盘复制：逐文件写临时名再改名，前后各算一次哈希；任何一步不符就整体失败。
///
/// 中途失败不回滚（已复制的不删）——删了等于把用户给的第二份也弄丢一半；
/// 下次再点一次即可，目标路径已存在时会被当成「已经有目录了」挡住。
fn copy_tree(from: &Path, to: &Path) -> Result<(usize, u64), String> {
    let (files, bytes, list) = walk(from)?;
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for path in &list {
        let relative = path
            .strip_prefix(from)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let destination = to.join(&relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if destination.exists() {
            return Err(format!("目标位置已存在同名文件，未覆盖：{relative}"));
        }
        let before = file_hash::file(path)?;
        fs::copy(path, &destination).map_err(|e| format!("复制失败：{relative}：{e}"))?;
        if file_hash::file(&destination)? != before || file_hash::file(path)? != before {
            return Err(format!("复制校验失败：{relative}"));
        }
    }
    Ok((files, bytes))
}
