use crate::{
    library_commands, library_files, library_layout,
    library_registry::{self, Host},
    pixcall, store_protocol,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::Value;
use std::path::PathBuf;
#[tauri::command]
async fn prepare_acquisition(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
    paths: Vec<String>,
    target: String,
    collection_id: Option<String>,
) -> Result<crate::acquisition::Prepared, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        library_commands::with_root(&host, &library_root, &library_session, |root| {
            crate::acquisition::prepare(root, &paths, &target, collection_id.as_deref())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn clipboard_file_paths(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
) -> Result<Vec<String>, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        library_commands::with_root(&host, &library_root, &library_session, |_| {
            crate::clipboard_paths::read()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn library_manage(host: tauri::State<'_, Host>, request: Value) -> Result<Value, String> {
    let host = host.inner().clone();
    let request = serde_json::from_value(request).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || library_commands::execute(&host, request))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn library_store(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
    request: Value,
) -> Result<Value, String> {
    let host = host.inner().clone();
    let request = serde_json::from_value(request).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        library_commands::with_root(&host, &library_root, &library_session, |root| {
            store_protocol::execute(root, request)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn library_info(host: tauri::State<'_, Host>) -> Result<Value, String> {
    let manager = host.manager.lock().map_err(|_| "资料库管理不可用")?;
    Ok(manager.active.as_ref().map(|a|serde_json::json!({"path":a.info.library.path,"exists":true,"custom":true,"id":a.info.library.id,"name":a.info.library.name,"session":a.info.session})).unwrap_or(serde_json::json!({"path":"","exists":false,"custom":false})))
}
#[tauri::command]
async fn save_blob(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
    relative_path: String,
    data: String,
) -> Result<String, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        library_commands::with_root(&host, &library_root, &library_session, |root| {
            let bytes = B64.decode(data).map_err(|e| e.to_string())?;
            library_files::write_file(root, &relative_path, &bytes)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn load_blob(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
    relative_path: String,
    item_id: Option<String>,
) -> Result<String, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        library_commands::with_root(&host, &library_root, &library_session, |root| {
            Ok(B64.encode(
                std::fs::read(if let Some(id) = item_id.as_deref() {
                    crate::file_trash::original(root, id, &relative_path)?
                } else {
                    library_files::checked_path(root, &relative_path)?
                })
                .map_err(|e| e.to_string())?,
            ))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn copy_library_file(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
    source: String,
    relative_path: String,
    hash: String,
) -> Result<String, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        library_commands::with_root(&host, &library_root, &library_session, |root| {
            library_files::copy_verified(root, &PathBuf::from(source), &relative_path, &hash)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn create_library_folder(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
    relative_path: String,
) -> Result<String, String> {
    library_commands::with_root(&host, &library_root, &library_session, |root| {
        library_files::create_folder(root, &relative_path)
    })
}
#[tauri::command]
async fn scan_library_files(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
) -> Result<library_files::DiskScan, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        library_commands::with_root(&host, &library_root, &library_session, library_files::scan)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn move_library_item(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
    id: String,
    relative_path: String,
    task_id: String,
) -> Result<String, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        library_commands::with_root(&host, &library_root, &library_session, |root| {
            library_layout::move_item(root, &id, &relative_path, &task_id)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn fingerprint_library_file(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
    relative_path: String,
) -> Result<Value, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        library_commands::with_root(&host, &library_root, &library_session, |root| {
            crate::library_scan::fingerprint(root, &relative_path)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn watch_library(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
) -> Result<Value, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut manager = host.manager.lock().map_err(|_| "资料库状态不可用")?;
        manager.checked(&library_root, &library_session)?;
        Ok(serde_json::json!(manager
            .active
            .as_mut()
            .ok_or("尚未打开资料库")?
            .watch
            .poll()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn export_library_catalog(
    host: tauri::State<'_, Host>,
    library_root: String,
    library_session: String,
) -> Result<String, String> {
    library_commands::with_root(
        &host,
        &library_root,
        &library_session,
        library_layout::export_catalog,
    )
}
#[tauri::command]
async fn pixcall_scan(root: String, limit: Option<usize>) -> Result<pixcall::PixcallScan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pixcall::scan(std::path::Path::new(&root), limit.unwrap_or(0))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_binary(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pixcall::read_file_base64(std::path::Path::new(&path)).map(|(data, _)| data)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err("路径不存在".into());
    }
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn MessageBoxW(
        hwnd: *mut std::ffi::c_void,
        text: *const u16,
        caption: *const u16,
        utype: u32,
    ) -> i32;
}

/// 启动阶段的致命错误：给一个看得见的提示，然后退出。
///
/// 不用 `expect`：发布版是 `panic = "abort"`，从资源管理器双击启动时没有控制台，
/// 用户只会看到窗口闪一下就没了。这里直接调系统 MessageBox —— 不引新依赖，
/// 也不依赖 Tauri 已经初始化（此刻还没有 AppHandle，弹不出应用内对话框）。
#[cfg(windows)]
fn fatal(message: &str) -> ! {
    const MB_ICONERROR: u32 = 0x10;
    let wide = |text: &str| -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        std::ffi::OsStr::new(text)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };
    let body = wide(message);
    let caption = wide("Ceas 无法启动");
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            caption.as_ptr(),
            MB_ICONERROR,
        );
    }
    std::process::exit(1)
}

#[cfg(not(windows))]
fn fatal(message: &str) -> ! {
    eprintln!("Ceas 无法启动：{message}");
    std::process::exit(1)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let directory = match library_registry::runtime_directory() {
        Ok(directory) => directory,
        Err(error) => fatal(&format!(
            "{error}\n\n\
             Ceas 的配置、WebView2 用户目录和临时文件都必须放在非 C 盘位置。\n\
             处理办法（任选其一）：\n\
             1. 设置环境变量 CEAS_CONFIG_DIR 指向非系统盘，例如 E:\\Ceas\\config；\n\
             2. 把程序安装到非系统盘后重新启动。"
        )),
    };
    let host = match library_commands::host(directory) {
        Ok(host) => host,
        Err(error) => fatal(&format!(
            "资料库管理配置无法打开：{error}\n\n\
             请检查配置目录是否可写、磁盘是否已满，或该目录是否被其他进程占用。"
        )),
    };
    let result = tauri::Builder::default()
        .manage(host)
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            library_manage,
            prepare_acquisition,
            clipboard_file_paths,
            library_info,
            library_store,
            save_blob,
            load_blob,
            copy_library_file,
            create_library_folder,
            scan_library_files,
            move_library_item,
            fingerprint_library_file,
            watch_library,
            export_library_catalog,
            pixcall_scan,
            read_binary,
            reveal_in_explorer
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        fatal(&format!("主窗口启动失败：{error}"));
    }
}
