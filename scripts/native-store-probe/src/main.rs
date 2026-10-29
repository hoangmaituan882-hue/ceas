#[path = "../../../src-tauri/src/acquisition.rs"]
mod acquisition;
#[path = "../../../src-tauri/src/clipboard_paths.rs"]
mod clipboard_paths;
#[path = "../../../src-tauri/src/collection_recover.rs"]
mod collection_recover;
#[path = "../../../src-tauri/src/collection_store.rs"]
mod collection_store;
#[path = "../../../src-tauri/src/directory_operations.rs"]
mod directory_operations;
#[path = "../../../src-tauri/src/directory_tree.rs"]
mod directory_tree;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use std::{
    io::{self, BufRead},
    path::{Path, PathBuf},
};
#[path = "../../../src-tauri/src/file_hash.rs"]
mod file_hash;
#[path = "../../../src-tauri/src/file_observation.rs"]
mod file_observation;
#[path = "../../../src-tauri/src/file_operations.rs"]
mod file_operations;
#[path = "../../../src-tauri/src/file_reconcile.rs"]
mod file_reconcile;
#[path = "../../../src-tauri/src/file_trash.rs"]
mod file_trash;
#[path = "../../../src-tauri/src/library_commands.rs"]
mod library_commands;
#[path = "../../../src-tauri/src/library_files.rs"]
mod library_files;
#[path = "../../../src-tauri/src/library_format.rs"]
mod library_format;
#[path = "../../../src-tauri/src/library_layout.rs"]
mod library_layout;
#[path = "../../../src-tauri/src/library_registry.rs"]
mod library_registry;
#[path = "../../../src-tauri/src/library_scan.rs"]
mod library_scan;
#[path = "../../../src-tauri/src/library_transfer.rs"]
mod library_transfer;
#[path = "../../../src-tauri/src/library_watch.rs"]
mod library_watch;
#[path = "../../../src-tauri/src/pixcall.rs"]
mod pixcall;
#[path = "../../../src-tauri/src/store.rs"]
mod store;
#[path = "../../../src-tauri/src/store_protocol.rs"]
mod store_protocol;
#[path = "../../../src-tauri/src/store_schema.rs"]
mod store_schema;
fn execute(host: &library_registry::Host, value: Value) -> Result<Value, String> {
    let command = value["command"].as_str().unwrap_or("library_store");
    let args = value.get("args").unwrap_or(&value);
    let text = |key: &str| -> Result<&str, String> {
        args[key].as_str().ok_or_else(|| format!("missing {key}"))
    };
    if command == "library_manage" {
        return library_commands::execute(
            host,
            serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?,
        );
    }
    if command == "watch_library" {
        let mut manager = host.manager.lock().unwrap();
        manager.checked(text("libraryRoot")?, text("librarySession")?)?;
        return Ok(json!(manager.active.as_mut().unwrap().watch.poll()));
    }
    if command == "library_info" {
        return Ok(host.manager.lock().unwrap().snapshot()["active"].clone());
    }
    if command == "pixcall_scan" {
        return Ok(json!(pixcall::scan(Path::new(text("root")?), 0)?));
    }
    if command == "read_binary" {
        return Ok(json!(
            pixcall::read_file_base64(Path::new(text("path")?))?.0
        ));
    }
    library_commands::with_root(
        host,
        text("libraryRoot")?,
        text("librarySession")?,
        |root| match command {
            "prepare_acquisition" => Ok(json!(acquisition::prepare(
                root,
                &serde_json::from_value::<Vec<String>>(args["paths"].clone())
                    .map_err(|e| e.to_string())?,
                text("target")?,
                args["collectionId"].as_str()
            )?)),
            "clipboard_file_paths" => Ok(json!(clipboard_paths::read()?)),
            "library_store" => store_protocol::execute(
                root,
                serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?,
            ),
            "save_blob" => Ok(json!(library_files::write_file(
                root,
                text("relativePath")?,
                &B64.decode(text("data")?).map_err(|e| e.to_string())?
            )?)),
            "load_blob" => Ok(json!(B64.encode(
                std::fs::read(if let Some(id) = args["itemId"].as_str() {
                    file_trash::original(root, id, text("relativePath")?)?
                } else {
                    library_files::checked_path(root, text("relativePath")?)?
                })
                .map_err(|e| e.to_string())?
            ))),
            "copy_library_file" => Ok(json!(library_files::copy_verified(
                root,
                Path::new(text("source")?),
                text("relativePath")?,
                text("hash")?
            )?)),
            "create_library_folder" => Ok(json!(library_files::create_folder(
                root,
                text("relativePath")?
            )?)),
            "scan_library_files" => Ok(json!(library_files::scan(root)?)),
            "move_library_item" => Ok(json!(library_layout::move_item(
                root,
                text("id")?,
                text("relativePath")?,
                text("taskId")?
            )?)),
            "fingerprint_library_file" => library_scan::fingerprint(root, text("relativePath")?),
            "export_library_catalog" => Ok(json!(library_layout::export_catalog(root)?)),
            _ => Err(format!("unknown {command}")),
        },
    )
}
fn main() {
    let directory = std::env::var_os("CEAS_CONFIG_DIR")
        .map(PathBuf::from)
        .expect("isolated config required");
    let host = library_commands::host(directory).expect("isolated library host");
    for line in io::stdin().lock().lines() {
        let result = line
            .map_err(|e| e.to_string())
            .and_then(|line| serde_json::from_str(&line).map_err(|e| e.to_string()))
            .and_then(|value| execute(&host, value));
        println!(
            "{}",
            match result {
                Ok(value) => json!({"ok":value}),
                Err(error) => json!({"error":error}),
            }
        );
    }
}
