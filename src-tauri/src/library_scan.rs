use crate::file_observation::{self, Observation};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub rel_path: String,
    pub path: String,
    #[serde(flatten)]
    pub observation: Observation,
}
#[derive(Clone, Serialize)]
pub struct Warning {
    pub path: String,
    pub message: String,
}
#[derive(Clone, Serialize)]
pub struct Directory {
    pub path: String,
    pub identity: Option<String>,
}
#[derive(Serialize)]
pub struct Scan {
    pub entries: Vec<Entry>,
    pub folders: Vec<String>,
    pub directories: Vec<Directory>,
    pub warnings: Vec<Warning>,
    pub ignored: usize,
}
pub fn scan(root: &Path) -> Result<Scan, String> {
    crate::library_format::manifest(root)?;
    let mut result = Scan {
        entries: vec![],
        folders: vec![],
        directories: vec![],
        warnings: vec![],
        ignored: 0,
    };
    let mut pending = vec![(root.to_path_buf(), 0)];
    while let Some((directory, depth)) = pending.pop() {
        let relative = directory
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if depth > 128 {
            result.warnings.push(Warning {
                path: relative,
                message: "目录过深，未继续扫描".into(),
            });
            continue;
        }
        if depth > 0 && (directory.join(".ceas").exists() || directory.join(".pixcall").exists()) {
            result.warnings.push(Warning {
                path: relative,
                message: "发现嵌套资料库，未扫描其内部".into(),
            });
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                result.warnings.push(Warning {
                    path: relative,
                    message: format!("目录无法读取：{error}"),
                });
                continue;
            }
        };
        if depth > 0 {
            result.directories.push(Directory {
                path: relative.clone(),
                identity: file_observation::identity(&directory),
            });
            result.folders.push(relative);
        }
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    result.warnings.push(Warning {
                        path: directory.to_string_lossy().into(),
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if [".ceas", ".pixcall", ".DS_Store", "Thumbs.db", "desktop.ini"]
                .contains(&name.as_str())
                || name.starts_with(".ceas-")
            {
                result.ignored += 1;
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let inspect = (|| {
                if file_observation::is_link(&path)? {
                    return Err("路径链接或重解析点未进入扫描".into());
                }
                crate::library_files::checked_path(root, &rel)?;
                let kind = entry.file_type().map_err(|e| e.to_string())?;
                if kind.is_dir() {
                    pending.push((path.clone(), depth + 1));
                } else if kind.is_file() {
                    let observation = file_observation::inspect(&path)?;
                    result.entries.push(Entry {
                        name,
                        rel_path: rel.clone(),
                        path: path.to_string_lossy().into(),
                        observation,
                    });
                }
                Ok(())
            })();
            if let Err(message) = inspect {
                result.warnings.push(Warning { path: rel, message });
            }
        }
    }
    result.entries.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    result.folders.sort();
    Ok(result)
}
pub fn fingerprint(root: &Path, relative: &str) -> Result<serde_json::Value, String> {
    let path = crate::library_files::checked_path(root, relative)?;
    if file_observation::is_link(&path)? {
        return Err("不能关联路径链接".into());
    }
    let before = file_observation::inspect(&path)?;
    let hash = crate::file_hash::file(&path)?;
    let after = file_observation::inspect(&path)?;
    if before != after {
        return Err("文件仍在写入，稍后重试".into());
    }
    Ok(serde_json::json!({"hash":hash,"observation":after}))
}
