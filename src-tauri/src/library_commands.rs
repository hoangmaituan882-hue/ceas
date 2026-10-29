use crate::{
    library_format as format,
    library_registry::{Host, Manager},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Request {
    List,
    Probe {
        path: String,
    },
    Create {
        path: String,
        id: String,
        name: String,
        #[serde(default)]
        existing: bool,
    },
    Open {
        path: String,
    },
    Relocate {
        id: String,
        path: String,
    },
    Close,
    Forget {
        id: String,
    },
    Guide {
        step: usize,
        done: bool,
    },
    Rename {
        id: String,
        name: String,
        folder_name: Option<String>,
        task_id: String,
    },
    Move {
        id: String,
        target: String,
        task_id: String,
    },
    Task,
    CancelTask,
}
pub fn with_root<T>(
    host: &Host,
    root: &str,
    session: &str,
    work: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let manager = host.manager.lock().map_err(|_| "资料库管理状态不可用")?;
    let root = manager.checked(root, session)?;
    work(&root)
}
pub fn execute(host: &Host, request: Request) -> Result<Value, String> {
    match request {
        Request::Task => {
            return Ok(json!(*host
                .tasks
                .progress
                .lock()
                .map_err(|_| "任务状态不可用")?))
        }
        Request::CancelTask => {
            host.tasks.cancel.store(true, Ordering::Relaxed);
            return Ok(Value::Null);
        }
        Request::Probe { path } => {
            let root = Path::new(&path);
            if root.join(".pixcall/database/main.db").is_file() {
                return Ok(json!({"kind":"pixcall","path":path}));
            }
            return match format::inspect(root) {
                Ok(lib) => Ok(json!({"kind":"library","library":lib})),
                Err(error) => Ok(
                    json!({"kind":if !root.exists(){"missing"}else if root.join(".ceas").exists(){"damaged"}else{"folder"},"path":path,"error":error}),
                ),
            };
        }
        _ => {}
    }
    let mut manager = host.manager.lock().map_err(|_| "资料库管理状态不可用")?;
    match request {
        Request::List => {
            manager.refresh_active();
            Ok(manager.snapshot())
        }
        Request::Create {
            path,
            id,
            name,
            existing,
        } => Ok(json!(manager.create(
            Path::new(&path),
            &id,
            &name,
            existing
        )?)),
        Request::Open { path } => Ok(json!(manager.activate(Path::new(&path), None)?)),
        Request::Relocate { id, path } => Ok(json!(manager.activate(Path::new(&path), Some(&id))?)),
        Request::Close => {
            manager.close()?;
            Ok(Value::Null)
        }
        Request::Forget { id } => {
            manager.forget(&id)?;
            Ok(Value::Null)
        }
        Request::Guide { step, done } => {
            manager.guide(step, done)?;
            Ok(Value::Null)
        }
        Request::Rename {
            id,
            name,
            folder_name,
            task_id,
        } => {
            if name.trim() != name || name.is_empty() {
                return Err("请输入不含首尾空白的名称".into());
            }
            if let Some(folder) = folder_name {
                crate::library_files::normalize_relative(&folder)?;
                if folder.contains(['/', '\\']) {
                    return Err("文件夹名不能包含路径分隔符".into());
                }
                let source = manager
                    .registry
                    .libraries
                    .iter()
                    .find(|r| r.id == id)
                    .ok_or("资料库未登记")?;
                let target = PathBuf::from(&source.path)
                    .parent()
                    .ok_or("没有父目录")?
                    .join(folder);
                if Path::new(&source.path) != target {
                    crate::library_transfer::transfer(
                        &mut manager,
                        &host.tasks,
                        &task_id,
                        &id,
                        &target,
                        true,
                    )?;
                }
            }
            manager.name(&id, &name)?;
            Ok(manager.snapshot())
        }
        Request::Move {
            id,
            target,
            task_id,
        } => {
            crate::library_transfer::transfer(
                &mut manager,
                &host.tasks,
                &task_id,
                &id,
                Path::new(&target),
                false,
            )?;
            Ok(manager.snapshot())
        }
        _ => Err("资料库请求不可用".into()),
    }
}
pub fn host(directory: PathBuf) -> Result<Host, String> {
    let manager = Manager::load(directory.clone())?;
    let tasks = crate::library_transfer::Tasks::load(&directory);
    Ok(std::sync::Arc::new(crate::library_registry::HostState {
        manager: std::sync::Mutex::new(manager),
        tasks,
    }))
}
