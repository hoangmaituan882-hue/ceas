use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
pub struct Entry {
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub hash: String,
}
pub fn snapshot(directory: &Path) -> Result<Vec<Entry>, String> {
    if !directory.is_dir() || crate::file_observation::is_link(directory)? {
        return Err("目录不可用或是路径链接".into());
    }
    let mut pending = vec![(directory.to_path_buf(), 0)];
    let mut entries = vec![];
    while let Some((folder, depth)) = pending.pop() {
        if depth > 128 {
            return Err("目录层级过深".into());
        }
        for entry in fs::read_dir(&folder).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let relative = path
                .strip_prefix(directory)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            crate::library_files::normalize_relative(&relative)?;
            if crate::file_observation::is_link(&path)? {
                return Err(format!("目录含路径链接，未执行：{relative}"));
            }
            let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
            if meta.is_dir() {
                entries.push(Entry {
                    path: relative,
                    kind: "directory".into(),
                    size: 0,
                    hash: String::new(),
                });
                pending.push((path, depth + 1));
            } else if meta.is_file() {
                let before = crate::file_observation::inspect(&path)?;
                let hash = crate::file_hash::file(&path)?;
                if before != crate::file_observation::inspect(&path)? {
                    return Err("目录内文件仍在写入，请稍后重试".into());
                }
                entries.push(Entry {
                    path: relative,
                    kind: "file".into(),
                    size: meta.len(),
                    hash,
                });
            } else {
                return Err(format!("目录含不支持的对象：{relative}"));
            }
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}
