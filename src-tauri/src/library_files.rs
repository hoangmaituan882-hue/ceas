//! 普通目录树。原件保留文件名，哈希只用于校验。
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "windows")]
fn publish_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // 没有 REPLACE_EXISTING：已有同名文件不会被覆盖，exFAT 也不需要硬链接。
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 8) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
pub fn rename_no_replace(source: &Path, target: &Path) -> Result<(), String> {
    publish_file(source, target).map_err(|e| format!("文件移动未完成，未覆盖目标：{e}"))?;
    #[cfg(not(windows))]
    fs::remove_file(source).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(not(target_os = "windows"))]
fn publish_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::hard_link(temporary, destination)
}

pub fn normalize_relative(value: &str) -> Result<String, String> {
    let path = value.replace('\\', "/");
    if path.is_empty()
        || path.split('/').any(|part| {
            let lower = part.to_ascii_lowercase();
            let base = lower.split('.').next().unwrap_or("");
            part.is_empty()
                || part == "."
                || part == ".."
                || part.ends_with(['.', ' '])
                || part.chars().any(|ch| ch < ' ' || "<>:\"|?*".contains(ch))
                || ["con", "prn", "aux", "nul", ".ceas", ".pixcall"].contains(&lower.as_str())
                || ["con", "prn", "aux", "nul"].contains(&base)
                || (base.len() == 4
                    && (base.starts_with("com") || base.starts_with("lpt"))
                    && base.as_bytes()[3] >= b'1'
                    && base.as_bytes()[3] <= b'9')
        })
    {
        return Err("文件名或相对路径不可跨平台使用".into());
    }
    Ok(path)
}

pub fn checked_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    crate::store::validate_root(root)?;
    let relative = normalize_relative(relative)?;
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(relative);
    crate::store::validate_root(&path)?;
    for ancestor in path.ancestors().take_while(|p| *p != root) {
        if let Ok(canonical) = ancestor.canonicalize() {
            if !canonical.starts_with(&canonical_root) {
                return Err("路径链接指向资料库之外".into());
            }
        }
    }
    Ok(path)
}

pub fn create_folder(root: &Path, relative: &str) -> Result<String, String> {
    crate::directory_operations::ensure_clear(root)?;
    let relative = normalize_relative(relative)?;
    let path = checked_path(root, &relative)?;
    fs::create_dir_all(&path).map_err(|e| format!("创建收藏集文件夹失败：{e}"))?;
    Ok(relative)
}

fn with_temporary<F>(root: &Path, requested: &str, write: F) -> Result<String, String>
where
    F: FnOnce(&mut fs::File) -> Result<(), String>,
{
    crate::directory_operations::ensure_clear(root)?;
    let requested = normalize_relative(requested)?;
    let target = checked_path(root, &requested)?;
    let parent = target.parent().ok_or("文件没有父目录")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // 创建目录后再验一次，避免已有目录链接将写入导向库外。
    checked_path(root, &requested)?;
    let temporary = parent.join(format!(
        ".ceas-{}-{}.part",
        std::process::id(),
        NEXT_FILE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        write(&mut file)?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        let name = target.file_name().ok_or("缺少文件名")?.to_string_lossy();
        let stem = target.file_stem().unwrap_or_default().to_string_lossy();
        let extension = target
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        for index in 0..10_000 {
            let candidate = if index == 0 {
                target.clone()
            } else {
                parent.join(format!("{stem} ({index}){extension}"))
            };
            // 发布必须不可覆盖，已有同名文件只产生带序号的新文件。
            match publish_file(&temporary, &candidate) {
                Ok(()) => {
                    return Ok(candidate
                        .strip_prefix(root)
                        .map_err(|e| e.to_string())?
                        .to_string_lossy()
                        .replace('\\', "/"))
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("写入 {name} 失败：{error}")),
            }
        }
        Err("同名文件过多，请更换文件名".into())
    })();
    let _ = fs::remove_file(&temporary);
    result
}

pub fn write_file(root: &Path, relative: &str, bytes: &[u8]) -> Result<String, String> {
    with_temporary(root, relative, |file| {
        file.write_all(bytes).map_err(|e| e.to_string())
    })
}
pub fn copy_file(root: &Path, source: &Path, relative: &str) -> Result<String, String> {
    let target = checked_path(root, relative)?;
    if source.canonicalize().ok() == target.canonicalize().ok() && source.is_file() {
        return normalize_relative(relative);
    }
    with_temporary(root, relative, |file| {
        let mut input = fs::File::open(source).map_err(|e| format!("读取原件失败：{e}"))?;
        if !input.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("来源不是普通文件".into());
        }
        std::io::copy(&mut input, file)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
}
pub fn copy_verified(
    root: &Path,
    source: &Path,
    relative: &str,
    hash: &str,
) -> Result<String, String> {
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("原件校验需要完整 SHA-256".into());
    }
    if !crate::file_hash::file(source)?.eq_ignore_ascii_case(hash) {
        return Err("来源文件在处理期间发生变化，请重试".into());
    }
    let destination = copy_file(root, source, relative)?;
    if !crate::file_hash::file(&checked_path(root, &destination)?)?.eq_ignore_ascii_case(hash) {
        return Err("复制校验失败，原件与副本均保留，请重新扫描或重试".into());
    }
    Ok(destination)
}

pub use crate::library_scan::Scan as DiskScan;
pub fn scan(root: &Path) -> Result<DiskScan, String> {
    crate::library_scan::scan(root)
}

#[cfg(test)]
#[path = "library_files_tests.rs"]
mod tests;
