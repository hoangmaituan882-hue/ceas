use super::*;
use std::path::PathBuf;
fn root(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("ceas-primary-{}-{name}", std::process::id()));
    // 本测试只清理 env.ps1 重定向后的自身目录。
    validate_root(&path).unwrap();
    let _ = std::fs::remove_dir_all(&path);
    crate::library_format::create(
        &path,
        "019a0000-0000-7000-8000-000000000001",
        "测试库",
        false,
    )
    .unwrap();
    path
}
fn row(id: &str) -> ItemRow {
    ItemRow {
        id: id.into(),
        hash: format!("hash-{id}"),
        name: format!("{id}.png"),
        w: 320,
        h: 240,
        bytes: 42,
        kind: "image".into(),
        duration: None,
        ext: Some("png".into()),
        color: None,
        created_at: 1,
        site: None,
        deleted_seq: None,
        ..ItemRow::default()
    }
}

/// 任务标识：回收/恢复要求 UUID 形状（`library_format::check_id`）。
fn task_id() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(80000);
    format!(
        "019a0000-0000-7000-8000-{:012x}",
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

/// 带真实原件的条目：回收要读盘校验哈希，不能用纯元数据行。
fn file_item(root: &std::path::Path, id: &str, name: &str) -> ItemRow {
    std::fs::write(root.join(name), format!("bytes-{id}")).unwrap();
    ItemRow {
        id: id.into(),
        hash: crate::file_hash::file(&root.join(name)).unwrap(),
        name: name.into(),
        w: 1,
        h: 1,
        bytes: 8,
        kind: "file".into(),
        relative_path: Some(name.into()),
        ..ItemRow::default()
    }
}

/// 准备一个真实收藏集目录并登记身份。
///
/// 存储层不再替测试补建收藏集（见 `collection_store::parent` 的注释），
/// 所以测试必须和前端一样：先建目录、先 `ensure`，再写入素材。
fn folder(root: &std::path::Path, path: &str) {
    crate::collection_store::test_folder(root, path);
}
#[test]
fn reopen_preserves_items_tags_and_view_state() {
    let path = root("reopen");
    upsert_items(&path, &[row("a")]).unwrap();
    replace_tags(&path, "a", &["参考".into()]).unwrap();
    set_state(&path, "ceas.board.v1", "[]").unwrap();
    assert_eq!(list(&path, 0).unwrap().len(), 1);
    assert_eq!(tags(&path).unwrap()["a"], vec!["参考"]);
    assert_eq!(state(&path).unwrap()["ceas.board.v1"], "[]");
}
#[test]
fn same_bytes_in_two_folders_keep_both_items_and_metadata() {
    let path = root("folder-locations");
    folder(&path, "品牌");
    folder(&path, "材质");
    let mut first = row("first");
    first.hash = "same".into();
    first.relative_path = Some("品牌/图.png".into());
    first.description = "描述".into();
    first.source_url = "https://example.com".into();
    first.rating = 5;
    first.palette = vec!["rgb(255, 0, 0)".into()];
    import_item(&path, first.clone(), &["风格/极简".into()], None).unwrap();
    let mut second = first.clone();
    second.id = "second".into();
    second.relative_path = Some("材质/图.png".into());
    upsert_items(&path, &[second]).unwrap();
    let rows = list(&path, 0).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].description, "描述");
    assert_eq!(rows[0].rating, 5);
    assert_eq!(rows[0].palette.len(), 1);
    assert_eq!(tags(&path).unwrap()["first"], vec!["风格/极简"]);
    let mut bad = first;
    bad.rating = 6;
    assert!(import_item(&path, bad, &["错误".into()], None).is_err());
    assert_eq!(tags(&path).unwrap()["first"], vec!["风格/极简"]);
}
#[test]
fn import_source_mapping_commits_with_metadata_and_rolls_back_with_tags() {
    let path = root("source-mapping");
    folder(&path, "目标");
    folder(&path, "新位置");
    let mut item = row("mapped");
    item.relative_path = Some("目标/图.png".into());
    import_item(&path, item.clone(), &["原标签".into()], Some("pixcall:20")).unwrap();
    assert_eq!(
        state(&path).unwrap()["ceas.import-path.pixcall:20"],
        "目标/图.png"
    );
    item.relative_path = Some("新位置/图.png".into());
    assert!(import_item(&path, item.clone(), &["未提交".into()], Some("")).is_err());
    assert_eq!(
        list(&path, 0).unwrap()[0].relative_path.as_deref(),
        Some("目标/图.png")
    );
    assert_eq!(tags(&path).unwrap()["mapped"], vec!["原标签"]);
    assert_eq!(
        state(&path).unwrap()["ceas.import-path.pixcall:20"],
        "目标/图.png"
    );
    upsert_items(&path, &[item]).unwrap();
    assert_eq!(
        state(&path).unwrap()["ceas.import-path.pixcall:20"],
        "新位置/图.png"
    );
}
#[test]
fn import_into_unregistered_folder_is_rejected() {
    let path = root("unregistered-folder");
    let mut item = row("loose");
    item.relative_path = Some("未登记/图.png".into());
    let error = import_item(&path, item, &[], None).unwrap_err();
    /* 生产分支（collection_store::parent 的 Err）必须有测试盯着：
    早期这条路径被 #[cfg(test)] 的自动补建挡住，等于没测。 */
    assert!(error.contains("收藏集尚未核对"), "{error}");
    assert!(list(&path, 0).unwrap().is_empty(), "失败不应留下半条记录");
}
#[test]
fn delete_is_monotonic_idempotent_and_does_not_cascade() {
    let path = root("delete");
    let a = file_item(&path, "a", "a.txt");
    let b = file_item(&path, "b", "b.txt");
    upsert_items(&path, &[a.clone(), b]).unwrap();
    replace_tags(&path, "a", &["保留".into()]).unwrap();
    /* 走真实回收路径：原件进 .ceas/trash，写入软删除与任务记录。
    不存在的 id 被跳过，重复回收不再叠加序号。 */
    assert_eq!(
        crate::file_trash::delete(&path, &["a".into(), "missing".into()], &task_id()).unwrap(),
        1
    );
    assert_eq!(
        crate::file_trash::delete(&path, &["a".into()], &task_id()).unwrap(),
        0,
        "重复回收不应再次命中"
    );
    assert_eq!(stats(&path).unwrap().items, 2);
    assert_eq!(stats(&path).unwrap().visible, 1);
    assert!(tags(&path).unwrap().is_empty(), "可见标签里不再有已回收项");
    assert_eq!(deleted_tags(&path).unwrap()["a"], vec!["保留"]);
    assert_eq!(list_trash(&path).unwrap().len(), 1);
    assert_eq!(
        open(&path)
            .unwrap()
            .query_row("select count(*) from item_tags", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1,
        "标签行不随删除级联"
    );
    assert_eq!(
        crate::file_trash::restore(&path, &["a".into()], &task_id(), None).unwrap(),
        1
    );
    assert_eq!(tags(&path).unwrap()["a"], vec!["保留"]);
    crate::file_trash::delete(&path, &["a".into()], &task_id()).unwrap();
    upsert_items(&path, &[a]).unwrap();
    assert_eq!(
        stats(&path).unwrap().visible,
        1,
        "普通 upsert 不能复活墓碑（可见的只剩 b）"
    );
}
#[test]
fn bad_batch_rolls_back_and_retry_cannot_resurrect_tombstones() {
    let path = root("migration");
    let mut bad = row("bad");
    bad.w = 0;
    assert!(upsert_items(&path, &[row("a"), bad]).is_err());
    assert_eq!(stats(&path).unwrap().items, 0);
    assert!(!state(&path).unwrap().contains_key("legacy-v2-complete"));
    let a = file_item(&path, "a", "a.txt");
    assert_eq!(upsert_items(&path, &[a.clone()]).unwrap(), 1);
    crate::file_trash::delete(&path, &["a".into()], &task_id()).unwrap();
    assert_eq!(upsert_items(&path, &[a]).unwrap(), 1);
    assert_eq!(stats(&path).unwrap().visible, 0, "重复 upsert 不能复活墓碑");
}
#[test]
fn libraries_are_isolated() {
    let a = root("a");
    let b = root("b");
    upsert_items(&a, &[row("one")]).unwrap();
    assert!(list(&b, 0).unwrap().is_empty());
    set_state(&a, "ceas.board.v1", "[1]").unwrap();
    assert!(state(&b).unwrap().is_empty());
}
#[test]
fn missing_manifest_does_not_recreate_a_library() {
    let path = root("missing-manifest");
    std::fs::remove_file(path.join(".ceas/library.json")).unwrap();
    assert!(open(&path).is_err());
    assert!(!path.join(".ceas/library.json").exists());
}
#[test]
fn rejects_future_schema() {
    let path = root("future");
    let c = open(&path).unwrap();
    c.pragma_update(None, "user_version", 999).unwrap();
    drop(c);
    assert!(open(&path).is_err());
}
