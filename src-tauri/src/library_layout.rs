use serde_json::json;
use std::{
    fs,
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT_EXPORT: AtomicU64 = AtomicU64::new(0);
pub fn move_item(root: &Path, id: &str, relative: &str, task: &str) -> Result<String, String> {
    crate::file_trash::move_item(root, id, relative, task)
}
pub fn export_catalog(root: &Path) -> Result<String, String> {
    let rows = crate::store::list(root, 0)?;
    if rows.iter().any(|row| row.relative_path.is_none()) {
        return Err("存在原件地址缺失的记录，请先检查资料库再导出目录索引".into());
    }
    let state = crate::store::state(root)?;
    let data = json!({"format":"ceas-library","version":1,"collections":crate::collection_store::list(root,false)?,"items":rows,"tags":crate::store::tags(root)?,
        "folders":state.get("ceas.folders.v1").and_then(|value|serde_json::from_str::<serde_json::Value>(value).ok()).unwrap_or(json!([])),
        "tag_groups":state.get("ceas.tag-groups.v1").and_then(|value|serde_json::from_str::<serde_json::Value>(value).ok()).unwrap_or(json!([]))});
    let directory = root.join(".ceas");
    crate::store::validate_root(&directory)?;
    if directory.exists()
        && !directory
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(root.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("元数据目录指向库外".into());
    }
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let target = directory.join("catalog.json");
    crate::store::validate_root(&target)?;
    let temporary = directory.join(format!(
        "catalog-{}-{}.part",
        std::process::id(),
        NEXT_EXPORT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    output
        .write_all(&serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);
    fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn root(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "ceas-layout-{}-{}-{name}",
            std::process::id(),
            NEXT_EXPORT.fetch_add(1, Ordering::Relaxed)
        ));
        crate::store::validate_root(&path).unwrap();
        fs::create_dir_all(&path).unwrap();
        crate::library_format::create(
            &path,
            "019a0000-0000-7000-8000-000000000002",
            "布局测试",
            true,
        )
        .unwrap();
        path
    }
    #[test]
    fn archive_move_undo_and_portable_catalog_preserve_original_and_tags() {
        let path = root("move");
        crate::library_files::write_file(&path, "图.png", b"original").unwrap();
        let row = crate::store::ItemRow {
            id: "id".into(),
            hash: crate::file_hash::file(&path.join("图.png")).unwrap(),
            name: "图.png".into(),
            w: 2,
            h: 2,
            bytes: 8,
            kind: "image".into(),
            relative_path: Some("图.png".into()),
            ..Default::default()
        };
        crate::store::import_item(&path, row, &["标签".into()], Some("pixcall:1")).unwrap();
        // 归档到收藏集：目录与身份必须先存在，移动才能解析归属。
        crate::collection_store::test_folder(&path, "收藏集");
        assert_eq!(
            move_item(
                &path,
                "id",
                "收藏集/图.png",
                "019a0000-0000-7000-8000-000000000021"
            )
            .unwrap(),
            "收藏集/图.png"
        );
        assert!(!path.join("图.png").exists());
        assert_eq!(fs::read(path.join("收藏集/图.png")).unwrap(), b"original");
        assert_eq!(
            crate::store::state(&path).unwrap()["ceas.import-path.pixcall:1"],
            "收藏集/图.png"
        );
        move_item(
            &path,
            "id",
            "图.png",
            "019a0000-0000-7000-8000-000000000022",
        )
        .unwrap();
        assert_eq!(
            crate::store::state(&path).unwrap()["ceas.import-path.pixcall:1"],
            "图.png"
        );
        assert_eq!(crate::store::tags(&path).unwrap()["id"], vec!["标签"]);
        let catalog = export_catalog(&path).unwrap();
        let data: serde_json::Value = serde_json::from_slice(&fs::read(catalog).unwrap()).unwrap();
        assert_eq!(data["items"][0]["relative_path"], "图.png");
        assert_eq!(data["tags"]["id"][0], "标签");
    }
    #[test]
    fn missing_original_path_does_not_create_a_replacement_file() {
        let path = root("missing-path");
        crate::store::upsert_items(
            &path,
            &[crate::store::ItemRow {
                id: "old".into(),
                hash: "aabb".into(),
                name: "旧图.png".into(),
                ext: Some("png".into()),
                w: 1,
                h: 1,
                bytes: 6,
                kind: "image".into(),
                ..Default::default()
            }],
        )
        .unwrap();
        assert!(export_catalog(&path).is_err());
        assert!(move_item(
            &path,
            "old",
            "旧图.png",
            "019a0000-0000-7000-8000-000000000023"
        )
        .is_err());
        assert!(!path.join("旧图.png").exists());
        assert!(!path.join("blobs").exists());
    }
}
