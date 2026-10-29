use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub id: String,
    pub format_version: u32,
}
#[derive(Clone, Debug, Serialize)]
pub struct Library {
    pub id: String,
    pub name: String,
    pub path: String,
    pub count: i64,
}

pub fn check_id(id: &str) -> Result<(), String> {
    let bytes = id.as_bytes();
    if bytes.len() != 36
        || bytes[14] != b'7'
        || !matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        || bytes.iter().enumerate().any(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                *b != b'-'
            } else {
                !b.is_ascii_hexdigit()
            }
        })
    {
        return Err("资料库身份必须为 UUIDv7".into());
    }
    Ok(())
}
pub fn internal_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    crate::store::validate_root(root)?;
    ensure_local(root)?;
    let canonical = root
        .canonicalize()
        .map_err(|_| "资料库位置暂不可用，请重新定位")?;
    let directory = root.join(".ceas");
    if !directory.is_dir()
        || !directory
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&canonical)
    {
        return Err("资料库系统目录缺失或指向库外".into());
    }
    let path = directory.join(name);
    crate::store::validate_root(&path)?;
    for ancestor in path.ancestors().take_while(|p| *p != root) {
        if let Ok(resolved) = ancestor.canonicalize() {
            if !resolved.starts_with(&canonical) {
                return Err("资料库系统路径指向库外".into());
            }
        }
    }
    if path.exists()
        && !path
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&canonical)
    {
        return Err("资料库元数据指向库外".into());
    }
    Ok(path)
}
pub fn manifest(root: &Path) -> Result<Manifest, String> {
    let path = internal_path(root, "library.json")?;
    let manifest: Manifest =
        serde_json::from_slice(&fs::read(path).map_err(|e| format!("资料库身份无法读取：{e}"))?)
            .map_err(|e| format!("资料库身份损坏：{e}"))?;
    check_id(&manifest.id)?;
    if manifest.format_version != 1 {
        return Err("资料库格式不受支持，请显式建立新测试库".into());
    }
    Ok(manifest)
}
pub fn inspect(root: &Path) -> Result<Library, String> {
    read_info(root, true)
}
pub fn summary(root: &Path) -> Result<Library, String> {
    read_info(root, false)
}
fn read_info(root: &Path, check_integrity: bool) -> Result<Library, String> {
    let manifest = manifest(root)?;
    let conn = Connection::open_with_flags(
        internal_path(root, "library.db")?,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("资料库数据库无法打开：{e}"))?;
    let name = crate::store_schema::verify(&conn, &manifest.id)?;
    if check_integrity {
        let check: String = conn
            .query_row("pragma quick_check", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if check != "ok" {
            return Err(format!("资料库检查失败：{check}"));
        }
    }
    let count = conn
        .query_row("select count(*) from v_items_visible", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(Library {
        id: manifest.id,
        name,
        path: root.to_string_lossy().to_string(),
        count,
    })
}
pub fn check_destination(root: &Path) -> Result<(), String> {
    crate::store::validate_root(root)?;
    ensure_local(root)?;
    if root.parent().is_none() || root.file_name().is_none() {
        return Err("请选择磁盘内的资料库文件夹，不要直接使用盘符根目录".into());
    }
    if root.to_string_lossy().replace('\\', "/").starts_with("//")
        && !root.to_string_lossy().starts_with("\\\\?\\")
    {
        return Err(
            "此工程版本暂不支持共享网络盘活动数据库，请复制到本地盘或通过服务器访问".into(),
        );
    }
    for ancestor in root.ancestors().skip(1) {
        if ancestor.join(".ceas").exists() || ancestor.join(".pixcall").exists() {
            return Err("资料库不能创建在另一个资料库里面".into());
        }
    }
    if root.exists() {
        if !root.is_dir() {
            return Err("请选择文件夹".into());
        }
        let mut pending = vec![(root.to_path_buf(), 0)];
        while let Some((directory, depth)) = pending.pop() {
            if depth > 128 {
                return Err("目录层级过深，无法完成建库预检".into());
            }
            for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                if [".ceas", ".pixcall"].contains(&entry.file_name().to_string_lossy().as_ref()) {
                    return Err("所选目录已有资料库或包含嵌套资料库，请选择打开或导入".into());
                }
                let kind = entry.file_type().map_err(|e| e.to_string())?;
                if kind.is_symlink() {
                    return Err("建库目录包含路径链接，请先选择没有链接的独立目录".into());
                }
                if kind.is_dir() {
                    pending.push((entry.path(), depth + 1));
                }
            }
        }
    }
    Ok(())
}
pub fn create(root: &Path, id: &str, name: &str, adopt: bool) -> Result<Library, String> {
    check_id(id)?;
    if adopt && !root.is_dir() {
        return Err("原地建索引的文件夹已不可用，请重新选择；未创建替代空目录".into());
    }
    check_destination(root)?;
    crate::library_files::normalize_relative(name)?;
    if name.contains(['/', '\\']) {
        return Err("资料库名称不能包含路径分隔符".into());
    }
    if root.exists() && !adopt {
        return Err("目标目录已存在，请选择使用已有普通文件夹或更换名称".into());
    }
    if !root.exists() {
        if !root.parent().is_some_and(Path::is_dir) {
            return Err("保存位置不可用".into());
        }
        fs::create_dir(root).map_err(|e| e.to_string())?;
    }
    let preparing = root.join(format!(".ceas-preparing-{id}"));
    fs::create_dir(&preparing).map_err(|e| format!("无法写入此位置：{e}"))?;
    let result = (|| {
        crate::store_schema::initialize(&preparing.join("library.db"), id, name)?;
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(preparing.join("library.json"))
            .map_err(|e| e.to_string())?;
        file.write_all(
            &serde_json::to_vec_pretty(&Manifest {
                id: id.into(),
                format_version: 1,
            })
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&preparing, root.join(".ceas")).map_err(|e| e.to_string())?;
        hide(&root.join(".ceas"));
        inspect(root)
    })();
    if preparing.exists() {
        let _ = fs::remove_dir_all(&preparing);
    } // 仅清理本次 create_dir 成功创建的临时辅助目录。
    result
}
#[cfg(windows)]
fn hide(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileAttributesW(path: *const u16) -> u32;
        fn SetFileAttributesW(path: *const u16, attributes: u32) -> i32;
    }
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let attributes = GetFileAttributesW(name.as_ptr());
        if attributes != u32::MAX {
            SetFileAttributesW(name.as_ptr(), attributes | 2);
        }
    }
}
#[cfg(not(windows))]
fn hide(_path: &Path) {}

#[cfg(windows)]
fn ensure_local(path: &Path) -> Result<(), String> {
    use std::path::{Component, Prefix};
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDriveTypeW(root: *const u16) -> u32;
    }
    let disk = match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(d) | Prefix::VerbatimDisk(d) => d,
            _ => return Err("此工程版本不支持共享网络盘活动资料库".into()),
        },
        _ => return Err("请选择本地绝对路径".into()),
    };
    let drive = [disk as u16, b':' as u16, b'\\' as u16, 0];
    if unsafe { GetDriveTypeW(drive.as_ptr()) } == 4 {
        return Err("共享网络盘不能作为此版本的活动数据库位置，请使用本地盘或服务器接口".into());
    }
    Ok(())
}
#[cfg(not(windows))]
fn ensure_local(_path: &Path) -> Result<(), String> {
    Ok(())
}
