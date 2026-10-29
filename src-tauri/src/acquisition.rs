//! 拖放/文件粘贴的路径准备。只遍历普通目录，输出路径与状态，原件复制沿用校验发布。
use crate::{file_observation, library_files};
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
pub struct Source {
    pub name: String,
    pub path: String,
    pub relative_path: Option<String>,
}
#[derive(Serialize)]
pub struct Warning {
    pub path: String,
    pub message: String,
}
#[derive(Serialize, Default)]
pub struct Prepared {
    pub sources: Vec<Source>,
    pub folders: Vec<String>,
    pub warnings: Vec<Warning>,
}
#[derive(Default)]
struct Tree {
    files: Vec<(PathBuf, String)>,
    folders: Vec<String>,
    warnings: Vec<Warning>,
}

fn collect(source: &Path) -> Result<Tree, String> {
    let mut tree = Tree::default();
    let mut pending = vec![(source.to_path_buf(), String::new(), 0)];
    while let Some((directory, relative, depth)) = pending.pop() {
        if depth > 128 {
            tree.warnings.push(Warning {
                path: directory.display().to_string(),
                message: "目录超过安全层级，未继续导入".into(),
            });
            continue;
        }
        if directory.join(".ceas").exists() || directory.join(".pixcall").exists() {
            tree.warnings.push(Warning {
                path: directory.display().to_string(),
                message: "发现资料库目录，请通过资料库导入入口处理".into(),
            });
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                tree.warnings.push(Warning {
                    path: directory.display().to_string(),
                    message: error.to_string(),
                });
                continue;
            }
        };
        tree.folders.push(relative.clone());
        for entry in entries {
            let result = (|| -> Result<(), String> {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let name = entry
                    .file_name()
                    .to_str()
                    .ok_or("文件名无法使用 UTF-8 表示")?
                    .to_owned();
                if [".DS_Store", "Thumbs.db", "desktop.ini"].contains(&name.as_str())
                    || name.starts_with(".ceas-")
                {
                    return Ok(());
                }
                let rel = if relative.is_empty() {
                    name.clone()
                } else {
                    format!("{relative}/{name}")
                };
                library_files::normalize_relative(&rel)?;
                if file_observation::is_link(&path)? {
                    return Err(format!("路径链接未导入：{}", path.display()));
                }
                let kind = entry.file_type().map_err(|e| e.to_string())?;
                if kind.is_dir() {
                    pending.push((path, rel, depth + 1));
                } else if kind.is_file() {
                    tree.files.push((path, rel));
                }
                Ok(())
            })();
            if let Err(message) = result {
                tree.warnings.push(Warning {
                    path: directory.display().to_string(),
                    message,
                });
            }
        }
    }
    tree.folders.sort();
    tree.files.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(tree)
}

fn reserve_folder(root: &Path, parent: &str, name: &str) -> Result<String, String> {
    let join = |name: &str| {
        if parent.is_empty() {
            name.to_string()
        } else {
            format!("{parent}/{name}")
        }
    };
    let conn = crate::store::open(root)?;
    for index in 0..10_000 {
        let name = if index == 0 {
            name.to_string()
        } else {
            format!("{name} ({index})")
        };
        let relative = join(&name);
        let path = library_files::checked_path(root, &relative)?;
        let occupied = fs::read_dir(path.parent().ok_or("目标没有上级目录")?)
            .map_err(|e| e.to_string())?
            .any(|entry| {
                entry
                    .map(|entry| {
                        entry.file_name().to_string_lossy().to_lowercase() == name.to_lowercase()
                    })
                    .unwrap_or(true)
            });
        let indexed: bool = conn
            .query_row(
                "select exists(select 1 from v_collections_visible where lower(path)=lower(?1))",
                [&relative],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if occupied || indexed {
            continue;
        }
        match fs::create_dir(&path) {
            Ok(()) => return Ok(relative),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("无法建立导入目录：{e}")),
        }
    }
    Err("同名收藏集过多，请更换位置".into())
}

pub fn prepare(
    root: &Path,
    paths: &[String],
    target: &str,
    collection_id: Option<&str>,
) -> Result<Prepared, String> {
    crate::directory_operations::ensure_clear(root)?;
    if !target.is_empty() {
        let row: Option<(String, String)> = crate::store::open(root)?
            .query_row(
                "select path,state from v_collections_visible where id=?1",
                [collection_id.ok_or("目标收藏集没有身份")?],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if row != Some((target.into(), "ready".into())) {
            return Err("目标收藏集已改变或不可用，请重新选择".into());
        }
        if !library_files::checked_path(root, target)?.is_dir() {
            return Err("目标收藏集目录不存在".into());
        }
    } else if collection_id.is_some() {
        return Err("目标收藏集地址不一致".into());
    }
    let real_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let destination = if target.is_empty() {
        real_root.clone()
    } else {
        fs::canonicalize(library_files::checked_path(root, target)?).map_err(|e| e.to_string())?
    };
    let mut prepared = Prepared::default();
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    for value in paths {
        let source = Path::new(value);
        let result = (|| -> Result<PathBuf, String> {
            for ancestor in source.ancestors() {
                if ancestor.exists() && file_observation::is_link(ancestor)? {
                    return Err("来源包含路径链接，未导入".into());
                }
            }
            let path = fs::canonicalize(source).map_err(|e| e.to_string())?;
            if path.is_dir() && (real_root.starts_with(&path) || destination.starts_with(&path)) {
                return Err("不能把资料库自身、上级目录或目标的上级目录导入库内".into());
            }
            Ok(path)
        })();
        match result {
            Ok(path) => {
                if seen.insert(path.to_string_lossy().to_lowercase()) {
                    selected.push(path);
                }
            }
            Err(message) => prepared.warnings.push(Warning {
                path: value.clone(),
                message,
            }),
        }
    }
    // 同时选父目录和其中的文件时，只复制一份，保留父目录给出的归属。
    let directories: HashSet<_> = selected
        .iter()
        .filter(|path| path.is_dir())
        .cloned()
        .collect();
    let selected: Vec<_> = selected
        .into_iter()
        .filter(|path| {
            !path
                .ancestors()
                .skip(1)
                .any(|parent| directories.contains(parent))
        })
        .collect();
    for source in selected {
        let result = (|| -> Result<(), String> {
            let name = source
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("无法识别来源名称")?;
            library_files::normalize_relative(name)?;
            if source.is_dir() {
                let tree = collect(&source)?;
                prepared.warnings.extend(tree.warnings);
                if tree.folders.is_empty() {
                    return Ok(());
                }
                let base = reserve_folder(root, target, name)?;
                for folder in tree.folders {
                    let relative = if folder.is_empty() {
                        base.clone()
                    } else {
                        format!("{base}/{folder}")
                    };
                    library_files::create_folder(root, &relative)?;
                    prepared.folders.push(relative);
                }
                for (path, relative) in tree.files {
                    prepared.sources.push(Source {
                        name: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into(),
                        path: path.display().to_string(),
                        relative_path: Some(format!("{base}/{relative}")),
                    });
                }
            } else if source.is_file() {
                prepared.sources.push(Source {
                    name: name.into(),
                    path: source.display().to_string(),
                    relative_path: if target.is_empty() {
                        None
                    } else {
                        Some(format!("{target}/{name}"))
                    },
                });
            } else {
                return Err("来源不是普通文件或文件夹".into());
            }
            Ok(())
        })();
        if let Err(message) = result {
            prepared.warnings.push(Warning {
                path: source.display().to_string(),
                message,
            });
        }
    }
    Ok(prepared)
}

#[cfg(test)]
#[path = "acquisition_tests.rs"]
mod tests;
