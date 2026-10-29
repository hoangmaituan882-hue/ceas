use crate::library_format::{self, Library};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Guide {
    pub step: usize,
    pub done: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Registration {
    pub id: String,
    pub name: String,
    pub path: String,
}
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Registry {
    pub current: Option<String>,
    pub libraries: Vec<Registration>,
    pub guide: Guide,
}
#[derive(Serialize)]
pub struct Entry {
    #[serde(flatten)]
    pub record: Registration,
    pub count: Option<i64>,
    pub error: Option<String>,
}
#[derive(Serialize, Clone)]
pub struct ActiveInfo {
    #[serde(flatten)]
    pub library: Library,
    pub session: String,
}
pub struct Active {
    pub info: ActiveInfo,
    pub _lease: Connection,
    pub watch: crate::library_watch::Watch,
}
pub struct Manager {
    pub directory: PathBuf,
    pub registry: Registry,
    pub active: Option<Active>,
    pub error: Option<String>,
    epoch: u64,
}
pub struct HostState {
    pub manager: Mutex<Manager>,
    pub tasks: crate::library_transfer::Tasks,
}
pub type Host = Arc<HostState>;

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    crate::store::validate_root(path)?;
    let temporary = path.with_extension(format!("{}.part", std::process::id()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if temporary.exists() {
        let _ = fs::remove_file(temporary);
    }
    result
}
pub fn runtime_directory() -> Result<PathBuf, String> {
    let root = std::env::var_os("CEAS_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::current_exe()
                .ok()?
                .parent()
                .map(|p| p.join("ceas-config"))
        })
        .ok_or("请配置非 C 盘运行目录")?;
    crate::store::validate_root(&root)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let profile = std::env::var_os("WEBVIEW2_USER_DATA_FOLDER")
        .map(PathBuf::from)
        .unwrap_or(root.join("webview"));
    crate::store::validate_root(&profile)?;
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", profile);
    let temp = root.join("tmp");
    fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    for key in ["TEMP", "TMP", "TMPDIR"] {
        std::env::set_var(key, &temp);
    }
    Ok(root)
}
fn lease(root: &Path) -> Result<Connection, String> {
    if library_format::internal_path(root, "operation.json")?.exists() {
        return Err("此资料库有未完成的管理任务，请从原设备恢复".into());
    }
    let directory = library_format::internal_path(root, "locks")?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let conn = Connection::open(directory.join("session.db")).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::ZERO)
        .map_err(|e| e.to_string())?;
    conn.execute_batch("create table if not exists session(id integer); begin immediate;")
        .map_err(|_| "资料库正在其他窗口或进程中使用，请先关闭该会话")?;
    Ok(conn)
}
pub fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a
            .to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy()),
        _ => false,
    }
}
impl Manager {
    pub fn load(directory: PathBuf) -> Result<Self, String> {
        crate::store::validate_root(&directory)?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let path = directory.join("libraries.json");
        let mut startup_error = None;
        let registry = if path.exists() {
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            match serde_json::from_slice(&bytes) {
                Ok(registry) => registry,
                Err(error) => {
                    let stamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|e| e.to_string())?
                        .as_millis();
                    let backup = directory.join(format!(
                        "libraries-recovery-{}-{stamp}.json",
                        std::process::id()
                    ));
                    fs::write(&backup, bytes).map_err(|e| e.to_string())?;
                    startup_error = Some(format!("资料库列表损坏，已保留备份 {}。请重新打开完整资料库；磁盘文件未变动。详情：{error}", backup.display()));
                    Registry::default()
                }
            }
        } else {
            Registry::default()
        };
        let mut manager = Self {
            directory,
            registry,
            active: None,
            error: None,
            epoch: 0,
        };
        if let Err(error) = crate::library_transfer::recover(&mut manager) {
            startup_error = Some(format!("管理任务记录无法恢复，原记录和文件均保留：{error}"));
        }
        let previous = manager.registry.current.clone().and_then(|id| {
            manager
                .registry
                .libraries
                .iter()
                .find(|r| r.id == id)
                .cloned()
        });
        if let Some(previous) = previous {
            if let Err(error) = manager.activate(Path::new(&previous.path), Some(&previous.id)) {
                manager.error = Some(error);
            }
        }
        if startup_error.is_some() {
            manager.error = startup_error;
        }
        Ok(manager)
    }
    pub fn persist(&mut self, next: Registry) -> Result<(), String> {
        write_json(&self.directory.join("libraries.json"), &next)?;
        self.registry = next;
        Ok(())
    }
    pub fn snapshot(&self) -> serde_json::Value {
        let entries: Vec<Entry> = self
            .registry
            .libraries
            .iter()
            .map(
                |record| match library_format::summary(Path::new(&record.path)) {
                    Ok(lib) if lib.id == record.id => Entry {
                        record: Registration {
                            name: lib.name,
                            ..record.clone()
                        },
                        count: Some(lib.count),
                        error: None,
                    },
                    Ok(_) => Entry {
                        record: record.clone(),
                        count: None,
                        error: Some("此位置的资料库身份已改变，请重新定位".into()),
                    },
                    Err(error) => Entry {
                        record: record.clone(),
                        count: None,
                        error: Some(error),
                    },
                },
            )
            .collect();
        let active = self.active.as_ref().and_then(|a| {
            entries
                .iter()
                .find(|r| r.record.id == a.info.library.id && r.error.is_none())
                .map(|r| {
                    let mut info = a.info.clone();
                    info.library.count = r.count.unwrap_or(0);
                    info
                })
        });
        serde_json::json!({"libraries":entries,"active":active,"guide":self.registry.guide,"error":self.error})
    }
    pub fn refresh_active(&mut self) {
        if let Some(active) = &self.active {
            if let Err(error) = library_format::manifest(Path::new(&active.info.library.path))
                .and_then(|m| {
                    if m.id == active.info.library.id {
                        Ok(m)
                    } else {
                        Err("当前位置的资料库身份已改变".into())
                    }
                })
            {
                self.error = Some(error);
                self.active = None;
            }
        }
    }
    pub fn activate(&mut self, path: &Path, expected: Option<&str>) -> Result<ActiveInfo, String> {
        let lib = library_format::inspect(path)?;
        if expected.is_some_and(|id| id != lib.id) {
            return Err("选中的资料库身份不同，请选择原来的完整资料库文件夹".into());
        }
        if let Some(active) = &self.active {
            if active.info.library.id == lib.id
                && same_path(path, Path::new(&active.info.library.path))
            {
                return Ok(active.info.clone());
            }
        }
        if expected.is_none()
            && self
                .registry
                .libraries
                .iter()
                .any(|r| r.id == lib.id && !same_path(path, Path::new(&r.path)))
        {
            return Err("同一资料库已有其他登记位置，请使用重新定位；独立副本不能自动合并".into());
        }
        let new_lease = lease(path)?;
        crate::directory_operations::issues(path, true)?;
        crate::file_operations::issues(path, true)?;
        let mut next = self.registry.clone();
        next.libraries.retain(|r| r.id != lib.id);
        next.libraries.insert(
            0,
            Registration {
                id: lib.id.clone(),
                name: lib.name.clone(),
                path: lib.path.clone(),
            },
        );
        next.current = Some(lib.id.clone());
        self.persist(next)?;
        self.epoch += 1;
        let info = ActiveInfo {
            session: format!("{}:{}:{}", lib.id, std::process::id(), self.epoch),
            library: lib,
        };
        self.active = Some(Active {
            info: info.clone(),
            _lease: new_lease,
            watch: crate::library_watch::Watch::new(path),
        });
        self.error = None;
        Ok(info)
    }
    pub fn checked(&self, root: &str, session: &str) -> Result<PathBuf, String> {
        let active = self.active.as_ref().ok_or("尚未打开资料库")?;
        if active.info.session != session
            || !same_path(Path::new(root), Path::new(&active.info.library.path))
        {
            return Err("资料库会话已改变，请重试当前操作".into());
        }
        let manifest = library_format::manifest(Path::new(root))?;
        if manifest.id != active.info.library.id {
            return Err("资料库身份已改变，已停止写入".into());
        }
        Ok(PathBuf::from(root))
    }
    pub fn create(
        &mut self,
        path: &Path,
        id: &str,
        name: &str,
        existing: bool,
    ) -> Result<ActiveInfo, String> {
        let library = library_format::create(path, id, name, existing)?;
        self.activate(Path::new(&library.path), None)
    }
    pub fn close(&mut self) -> Result<(), String> {
        let mut next = self.registry.clone();
        next.current = None;
        self.persist(next)?;
        self.active = None;
        Ok(())
    }
    pub fn forget(&mut self, id: &str) -> Result<(), String> {
        let mut next = self.registry.clone();
        next.libraries.retain(|r| r.id != id);
        if next.current.as_deref() == Some(id) {
            next.current = None;
        }
        self.persist(next)?;
        if self
            .active
            .as_ref()
            .is_some_and(|a| a.info.library.id == id)
        {
            self.active = None;
        }
        Ok(())
    }
    pub fn name(&mut self, id: &str, name: &str) -> Result<(), String> {
        if name.trim() != name || name.is_empty() {
            return Err("名称不能为空或包含首尾空白".into());
        }
        let registration = self
            .registry
            .libraries
            .iter()
            .find(|r| r.id == id)
            .cloned()
            .ok_or("资料库未登记")?;
        let path = Path::new(&registration.path);
        let info = library_format::inspect(path)?;
        if info.id != id {
            return Err("资料库身份不一致".into());
        }
        let _other_lease = if self
            .active
            .as_ref()
            .is_some_and(|a| a.info.library.id == id)
        {
            None
        } else {
            Some(lease(path)?)
        };
        let mut conn = crate::store::open(path)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "update library_meta set name=?1 where id=?2",
            rusqlite::params![name, id],
        )
        .map_err(|e| e.to_string())?;
        let mut next = self.registry.clone();
        for r in &mut next.libraries {
            if r.id == id {
                r.name = name.into();
            }
        }
        self.persist(next)?;
        tx.commit().map_err(|e| e.to_string())?;
        if let Some(active) = &mut self.active {
            if active.info.library.id == id {
                active.info.library.name = name.into();
            }
        }
        Ok(())
    }
    pub fn guide(&mut self, step: usize, done: bool) -> Result<(), String> {
        let mut next = self.registry.clone();
        next.guide = Guide {
            step: step.min(2),
            done,
        };
        self.persist(next)
    }
}
