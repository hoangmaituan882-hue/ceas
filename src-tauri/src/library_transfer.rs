use crate::{
    library_format as format,
    library_registry::{write_json, Manager, Registration},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Progress {
    pub id: String,
    pub library_id: String,
    pub source: String,
    pub target: String,
    pub staging: String,
    pub kind: String,
    pub phase: String,
    pub running: bool,
    pub bytes: u64,
    pub total: u64,
    pub files: usize,
    pub completed: usize,
    pub error: Option<String>,
}
pub struct Tasks {
    pub progress: Mutex<Option<Progress>>,
    pub cancel: AtomicBool,
}
impl Tasks {
    pub fn load(directory: &Path) -> Self {
        let progress = fs::read(directory.join("task.json"))
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok());
        Self {
            progress: Mutex::new(progress),
            cancel: AtomicBool::new(false),
        }
    }
    fn update(&self, directory: &Path, progress: &Progress, durable: bool) -> Result<(), String> {
        *self.progress.lock().map_err(|_| "迁移进度不可用")? = Some(progress.clone());
        if durable {
            let history = directory.join("tasks");
            fs::create_dir_all(&history).map_err(|e| e.to_string())?;
            write_json(&history.join(format!("{}.json", progress.id)), progress)?;
            write_json(&directory.join("task.json"), progress)?;
        }
        Ok(())
    }
}
fn remove_marker(root: &Path, id: &str) {
    let path = root.join(".ceas/operation.json");
    if fs::read(&path)
        .ok()
        .and_then(|v| serde_json::from_slice::<serde_json::Value>(&v).ok())
        .is_some_and(|v| v["id"].as_str() == Some(id))
    {
        let _ = fs::remove_file(path);
    }
}
pub fn recover(manager: &mut Manager) -> Result<(), String> {
    let file = manager.directory.join("task.json");
    if !file.exists() {
        return Ok(());
    }
    let mut task: Progress = serde_json::from_slice(&fs::read(&file).map_err(|e| e.to_string())?)
        .map_err(|e| format!("迁移记录无法读取：{e}"))?;
    format::check_id(&task.id)?;
    for p in [&task.source, &task.target, &task.staging] {
        crate::store::validate_root(Path::new(p))?;
    }
    let source = Path::new(&task.source);
    let target = Path::new(&task.target);
    let staging = Path::new(&task.staging);
    if task.running {
        if format::inspect(target).is_ok_and(|lib| lib.id == task.library_id)
            && (!source.exists() || task.phase == "activating")
        {
            let library = format::inspect(target)?;
            let mut next = manager.registry.clone();
            next.libraries.retain(|r| r.id != library.id);
            next.libraries.insert(
                0,
                Registration {
                    id: library.id.clone(),
                    name: library.name,
                    path: library.path,
                },
            );
            next.current = Some(library.id);
            manager.persist(next)?;
            task.phase = "completed".into();
            task.error = None;
        } else {
            if task.kind == "rename"
                && !source.exists()
                && format::inspect(staging).is_ok_and(|lib| lib.id == task.library_id)
            {
                fs::rename(staging, source).map_err(|e| e.to_string())?;
            }
            task.phase = "interrupted".into();
            task.error = Some("上次操作未完成；原位置保留，可重新选择并重试".into());
        }
        task.running = false;
        write_json(&file, &task)?;
    }
    remove_marker(source, &task.id);
    remove_marker(target, &task.id);
    Ok(())
}
#[derive(PartialEq)]
struct Tree {
    files: Vec<(PathBuf, u64)>,
    folders: Vec<PathBuf>,
}
fn collect(root: &Path) -> Result<Tree, String> {
    let mut pending = vec![(root.to_path_buf(), 0)];
    let mut files = Vec::new();
    let mut folders = Vec::new();
    while let Some((directory, depth)) = pending.pop() {
        if depth > 128 {
            return Err("迁移目录层级过深".into());
        }
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_path_buf();
            let text = relative.to_string_lossy().replace('\\', "/");
            if [".ceas/locks", ".ceas/cache", ".ceas/operation.json"].contains(&text.as_str())
                || [".ceas/library.db-wal", ".ceas/library.db-shm"].contains(&text.as_str())
            {
                continue;
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                return Err(format!("迁移包含路径链接，请先处理：{text}"));
            }
            if kind.is_dir() {
                folders.push(relative);
                pending.push((path, depth + 1));
            } else if kind.is_file() {
                files.push((relative, entry.metadata().map_err(|e| e.to_string())?.len()));
            }
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    folders.sort();
    Ok(Tree { files, folders })
}
fn checkpoint(root: &Path) -> Result<(), String> {
    let conn = crate::store::open(root)?;
    let busy: i64 = conn
        .query_row("pragma wal_checkpoint(TRUNCATE)", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if busy != 0 {
        return Err("数据库仍在使用，无法开始迁移".into());
    }
    Ok(())
}
pub fn transfer(
    manager: &mut Manager,
    tasks: &Tasks,
    id: &str,
    library_id: &str,
    target: &Path,
    rename: bool,
) -> Result<(), String> {
    format::check_id(id)?;
    let record = manager
        .registry
        .libraries
        .iter()
        .find(|r| r.id == library_id)
        .cloned()
        .ok_or("资料库未登记")?;
    let source = PathBuf::from(&record.path);
    let library = format::inspect(&source)?;
    if !crate::directory_operations::pending(&source)?.is_empty()
        || !crate::file_operations::pending(&source)?.is_empty()
    {
        return Err("此库有待恢复的文件操作，请先在文件核对面板处理后再迁移或改名".into());
    }
    if library.id != library_id {
        return Err("原位置资料库身份已改变".into());
    }
    if crate::library_registry::same_path(&source, target) && source == target {
        return Err("目标位置与当前位置相同".into());
    }
    crate::store::validate_root(target)?;
    let case_only = rename && crate::library_registry::same_path(&source, target);
    if target.exists() && !case_only {
        return Err("目标目录已存在，请选择一个不存在的完整目标位置".into());
    }
    if !target.parent().is_some_and(Path::is_dir) {
        return Err("目标父目录不可用".into());
    }
    if !case_only {
        format::check_destination(target)?;
    }
    let staging = target
        .parent()
        .ok_or("没有目标父目录")?
        .join(format!(".ceas-transfer-{id}"));
    if staging.exists() {
        return Err("该迁移的暂存位置已存在，请在管理页查看恢复记录".into());
    }
    // 所有目标预检通过后才变更会话，失败不会切走当前库。
    manager.activate(&source, Some(library_id))?;
    let mut progress = Progress {
        id: id.into(),
        library_id: library_id.into(),
        source: source.to_string_lossy().into(),
        target: target.to_string_lossy().into(),
        staging: staging.to_string_lossy().into(),
        kind: if rename { "rename" } else { "move" }.into(),
        phase: "preparing".into(),
        running: true,
        bytes: 0,
        total: 0,
        files: 0,
        completed: 0,
        error: None,
    };
    tasks.cancel.store(false, Ordering::Relaxed);
    tasks.update(&manager.directory, &progress, true)?;
    let result = (|| {
        write_json(
            &format::internal_path(&source, "operation.json")?,
            &serde_json::json!({"id":id}),
        )?;
        checkpoint(&source)?;
        if rename {
            manager.active = None;
            progress.phase = "renaming".into();
            tasks.update(&manager.directory, &progress, true)?;
            fs::rename(&source, &staging).map_err(|e| format!("目录改名失败：{e}"))?;
            if let Err(error) = fs::rename(&staging, target) {
                let _ = fs::rename(&staging, &source);
                return Err(format!("目录改名失败，已尝试恢复原位置：{error}"));
            }
        } else {
            let tree = collect(&source)?;
            let files = &tree.files;
            progress.total = files.iter().map(|(_, size)| size).sum();
            progress.files = files.len();
            if available_space(target.parent().ok_or("目标父目录不可用")?)? < progress.total
            {
                return Err("目标磁盘剩余空间不足，未开始复制".into());
            }
            progress.phase = "copying".into();
            tasks.update(&manager.directory, &progress, true)?;
            fs::create_dir(&staging).map_err(|e| e.to_string())?;
            for (relative, _) in files {
                if tasks.cancel.load(Ordering::Relaxed) {
                    return Err("已停止迁移，原位置保留；暂存副本可在恢复记录中查看".into());
                }
                let from = source.join(relative);
                let to = staging.join(relative);
                fs::create_dir_all(to.parent().ok_or("目标缺少父目录")?)
                    .map_err(|e| e.to_string())?;
                let before = fs::metadata(&from).map_err(|e| e.to_string())?;
                let mut input = fs::File::open(&from).map_err(|e| e.to_string())?;
                let mut output = fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&to)
                    .map_err(|e| e.to_string())?;
                let mut buffer = [0u8; 65536];
                loop {
                    if tasks.cancel.load(Ordering::Relaxed) {
                        return Err("已停止迁移，原位置保留".into());
                    }
                    let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
                    if count == 0 {
                        break;
                    }
                    output
                        .write_all(&buffer[..count])
                        .map_err(|e| e.to_string())?;
                    progress.bytes += count as u64;
                    tasks.update(&manager.directory, &progress, false)?;
                }
                output.sync_all().map_err(|e| e.to_string())?;
                drop(output);
                let after = fs::metadata(&from).map_err(|e| e.to_string())?;
                if before.len() != after.len()
                    || before.modified().ok() != after.modified().ok()
                    || crate::file_hash::file(&from)? != crate::file_hash::file(&to)?
                {
                    return Err(format!(
                        "来源发生变化或复制校验失败：{}",
                        relative.display()
                    ));
                }
                progress.completed += 1;
                tasks.update(&manager.directory, &progress, true)?;
            }
            progress.phase = "verifying".into();
            tasks.update(&manager.directory, &progress, true)?;
            if collect(&source)? != tree {
                return Err("原目录内容在迁移过程中发生变化，请重试".into());
            }
            for (relative, _) in files {
                if crate::file_hash::file(&source.join(relative))?
                    != crate::file_hash::file(&staging.join(relative))?
                {
                    return Err(format!("校验时来源内容已改变：{}", relative.display()));
                }
            }
            // 迁移保留全部普通目录，包括没有被素材扫描器收录的隐藏空目录。
            for folder in &tree.folders {
                fs::create_dir_all(staging.join(folder)).map_err(|e| e.to_string())?;
            }
            if format::inspect(&staging)?.id != library_id {
                return Err("目标身份校验失败".into());
            }
            fs::rename(&staging, target).map_err(|e| e.to_string())?;
        }
        progress.phase = "activating".into();
        tasks.update(&manager.directory, &progress, true)?;
        remove_marker(target, id);
        remove_marker(&source, id);
        manager.activate(target, Some(library_id))?;
        progress.phase = "completed".into();
        Ok(())
    })();
    progress.running = false;
    if let Err(error) = &result {
        progress.error = Some(error.clone());
        progress.phase = "failed".into();
    }
    remove_marker(&source, id);
    remove_marker(target, id);
    if manager.active.is_none() && source.exists() {
        let _ = manager.activate(&source, Some(library_id));
    }
    tasks.update(&manager.directory, &progress, true)?;
    result
}
#[cfg(windows)]
fn available_space(path: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            path: *const u16,
            available: *mut u64,
            total: *mut u64,
            free: *mut u64,
        ) -> i32;
    }
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0;
    if unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(format!(
            "无法检查目标空间：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(available)
}
#[cfg(not(windows))]
fn available_space(_path: &Path) -> Result<u64, String> {
    Ok(u64::MAX)
}
