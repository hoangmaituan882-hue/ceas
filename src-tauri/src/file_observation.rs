use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Observation {
    pub size: u64,
    pub stamp: String,
    pub identity: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Record {
    pub path: String,
    pub state: String,
    #[serde(flatten)]
    pub observation: Observation,
}
pub fn inspect(path: &Path) -> Result<Observation, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("不是普通文件".into());
    }
    let stamp = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos()
        .to_string();
    Ok(Observation {
        size: metadata.len(),
        stamp,
        identity: identity(path),
    })
}
pub fn is_link(path: &Path) -> Result<bool, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Ok(true);
        }
    }
    Ok(metadata.file_type().is_symlink())
}
#[cfg(windows)]
pub fn identity(path: &Path) -> Option<String> {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)]
    #[derive(Default)]
    struct Information {
        attributes: u32,
        created: [u32; 2],
        accessed: [u32; 2],
        written: [u32; 2],
        volume: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(
            handle: *mut std::ffi::c_void,
            information: *mut Information,
        ) -> i32;
    }
    use std::os::windows::fs::OpenOptionsExt;
    // 目录句柄需要 BACKUP_SEMANTICS；零访问权限足以读取身份，避免额外占用。
    let file = fs::OpenOptions::new()
        .read(true)
        .access_mode(0)
        .share_mode(7)
        .custom_flags(0x02000000)
        .open(path)
        .ok()?;
    let mut info = Information::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return None;
    }
    // 创建时间减少删除后复用文件号的误关联；仍不能把它当跨卷的永久身份。
    Some(format!(
        "{:08x}:{:08x}{:08x}:{:08x}{:08x}",
        info.volume, info.index_high, info.index_low, info.created[1], info.created[0]
    ))
}
#[cfg(not(windows))]
pub fn identity(_path: &Path) -> Option<String> {
    None
}

pub fn record(root: &Path, id: &str, path: &str) -> Option<(String, String)> {
    let observation = inspect(&crate::library_files::checked_path(root, path).ok()?).ok()?;
    Some((
        format!("ceas.file.{id}"),
        serde_json::to_string(&Record {
            path: path.into(),
            state: "ready".into(),
            observation,
        })
        .ok()?,
    ))
}
