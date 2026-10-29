use crate::{
    file_observation,
    file_operations::{self, Operation},
    file_reconcile, file_trash, library_format, library_scan, library_watch, store,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(100);
fn task() -> String {
    format!(
        "019a0000-0000-7000-8000-{:012x}",
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
fn root() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "ceas-file-tests-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    store::validate_root(&root).unwrap();
    fs::create_dir(&root).unwrap();
    library_format::create(&root, &task(), "核对测试", true).unwrap();
    root
}
fn item(root: &Path, id: &str, path: &str, bytes: &[u8]) {
    fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
    // 收藏集必须先登记：存储层不再替调用方补建（导入、移动、核对都遵守这条）。
    if let Some((folder, _)) = path.rsplit_once('/') {
        crate::collection_store::test_folder(root, folder);
    }
    fs::write(root.join(path), bytes).unwrap();
    store::import_item(
        root,
        store::ItemRow {
            id: id.into(),
            hash: crate::file_hash::file(&root.join(path)).unwrap(),
            name: path.rsplit('/').next().unwrap().into(),
            relative_path: Some(path.into()),
            w: 1,
            h: 1,
            bytes: bytes.len() as i64,
            kind: "file".into(),
            description: format!("描述 {id}"),
            rating: 4,
            ..Default::default()
        },
        &[format!("标签 {id}")],
        Some(&format!("source:{id}")),
    )
    .unwrap();
}
fn match_file(root: &Path, id: &str, previous: &str, target: &str) -> file_reconcile::Match {
    let row = store::list(root, 0)
        .unwrap()
        .into_iter()
        .find(|r| r.id == id)
        .unwrap();
    let entry = library_scan::scan(root)
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.rel_path == target)
        .unwrap();
    file_reconcile::Match {
        id: id.into(),
        previous: previous.into(),
        hash: row.hash.clone(),
        content_hash: crate::file_hash::file(&root.join(target)).unwrap(),
        entry,
    }
}
#[test]
fn trash_original_restore_collision_and_restart_keep_metadata_and_both_files() {
    let root = root();
    item(&root, "a", "收藏集/原名.txt", b"original");
    file_trash::delete(&root, &["a".into()], &task()).unwrap();
    assert!(!root.join("收藏集/原名.txt").exists());
    assert_eq!(store::list(&root, 0).unwrap().len(), 0);
    assert!(file_operations::issues(&root, true).unwrap().is_empty());
    item(&root, "new", "收藏集/原名.txt", b"replacement");
    let preview = file_trash::preview(&root, &["a".into()], None).unwrap();
    assert!(preview[0].conflict);
    assert!(preview[0].target.contains("恢复 1"));
    file_trash::restore(&root, &["a".into()], &task(), None).unwrap();
    let rows = store::list(&root, 0).unwrap();
    let a = rows.iter().find(|r| r.id == "a").unwrap();
    assert_eq!(a.description, "描述 a");
    assert_eq!(a.rating, 4);
    assert_eq!(
        fs::read(root.join(a.relative_path.as_ref().unwrap())).unwrap(),
        b"original"
    );
    assert_eq!(
        fs::read(root.join("收藏集/原名.txt")).unwrap(),
        b"replacement"
    );
    assert_eq!(store::tags(&root).unwrap()["a"], vec!["标签 a"]);
    assert_eq!(
        store::state(&root).unwrap()["ceas.import-path.source:a"],
        a.relative_path.as_deref().unwrap()
    );
    assert_eq!(
        store::state(&root).unwrap()["ceas.import-path.source:new"],
        "收藏集/原名.txt"
    );
}
#[test]
fn moved_file_before_database_commit_recovers_idempotently() {
    let root = root();
    item(&root, "a", "原件.txt", b"original");
    let row = store::list(&root, 0).unwrap().remove(0);
    let id = task();
    let op = Operation {
        key: format!("{id}-0"),
        kind: "trash".into(),
        id: "a".into(),
        hash: row.hash,
        original: "原件.txt".into(),
        source: "原件.txt".into(),
        target: format!("trash/{id}/原件.txt"),
        source_system: false,
        target_system: true,
        phase: "prepared".into(),
    };
    file_operations::save(&root, &op).unwrap();
    let target = file_operations::location(&root, &op.target, true).unwrap();
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::rename(root.join("原件.txt"), &target).unwrap();
    assert!(file_operations::issues(&root, true).unwrap().is_empty());
    assert_eq!(store::list_trash(&root).unwrap().len(), 1);
    assert!(file_operations::issues(&root, true).unwrap().is_empty());
    assert!(target.exists());
}
#[test]
fn restore_collision_after_preparation_can_choose_another_target() {
    let root = root();
    item(&root, "a", "A.txt", b"original");
    file_trash::delete(&root, &["a".into()], &task()).unwrap();
    let state = store::state(&root).unwrap();
    let old: Operation = serde_json::from_str(&state["ceas.trash.a"]).unwrap();
    let id = task();
    let mut op = Operation {
        key: format!("{id}-0"),
        kind: "restore".into(),
        id: "a".into(),
        hash: old.hash,
        original: old.original,
        source: old.target,
        target: "A.txt".into(),
        source_system: true,
        target_system: false,
        phase: "prepared".into(),
    };
    file_operations::save(&root, &op).unwrap();
    fs::write(root.join("A.txt"), b"keep me").unwrap();
    assert!(file_operations::execute(&root, &mut op).is_err());
    assert!(file_operations::issues(&root, false).unwrap()[0].retargetable);
    // 前端 retargetTask 会先 create_library_folder + ensure_collections，测试照做
    crate::collection_store::test_folder(&root, "恢复集");
    file_operations::retarget(&root, &op.key, "恢复集/A.txt").unwrap();
    assert_eq!(fs::read(root.join("A.txt")).unwrap(), b"keep me");
    assert_eq!(fs::read(root.join("恢复集/A.txt")).unwrap(), b"original");
    assert!(file_operations::pending(&root).unwrap().is_empty());
    let stale = store::list(&root, 0).unwrap().remove(0);
    file_trash::delete(&root, &["a".into()], &task()).unwrap();
    assert!(store::import_item_mode(&root, stale, &[], None, true).is_err());
    assert_eq!(store::list_trash(&root).unwrap().len(), 1);
}
#[test]
fn changed_source_can_cancel_prepared_operation_without_deleting_either_file() {
    let root = root();
    item(&root, "a", "原件.txt", b"original");
    let row = store::list(&root, 0).unwrap().remove(0);
    let id = task();
    let op = Operation {
        key: format!("{id}-0"),
        kind: "trash".into(),
        id: "a".into(),
        hash: row.hash,
        original: "原件.txt".into(),
        source: "原件.txt".into(),
        target: format!("trash/{id}/原件.txt"),
        source_system: false,
        target_system: true,
        phase: "prepared".into(),
    };
    file_operations::save(&root, &op).unwrap();
    fs::write(root.join("原件.txt"), b"edited").unwrap();
    let issues = file_operations::issues(&root, true).unwrap();
    assert_eq!(issues.len(), 1);
    assert!(issues[0].cancellable);
    file_operations::cancel(&root, &op.key).unwrap();
    assert_eq!(fs::read(root.join("原件.txt")).unwrap(), b"edited");
    assert_eq!(store::list(&root, 0).unwrap().len(), 1);
}
#[test]
fn rename_swap_and_displaced_file_keep_independent_identities() {
    let root = root();
    item(&root, "a", "A.txt", b"a");
    item(&root, "b", "B.txt", b"b");
    fs::rename(root.join("A.txt"), root.join("temp.txt")).unwrap();
    fs::rename(root.join("B.txt"), root.join("A.txt")).unwrap();
    fs::rename(root.join("temp.txt"), root.join("B.txt")).unwrap();
    let matches = [
        match_file(&root, "a", "A.txt", "B.txt"),
        match_file(&root, "b", "B.txt", "A.txt"),
    ];
    file_reconcile::apply(&root, &matches, &[], false).unwrap();
    assert_eq!(
        store::list(&root, 0)
            .unwrap()
            .iter()
            .find(|r| r.id == "a")
            .unwrap()
            .relative_path
            .as_deref(),
        Some("B.txt")
    );
    assert_eq!(
        store::state(&root).unwrap()["ceas.import-path.source:b"],
        "A.txt"
    );
    fs::remove_file(root.join("B.txt")).unwrap();
    fs::rename(root.join("A.txt"), root.join("B.txt")).unwrap();
    let outcome = file_reconcile::apply(
        &root,
        &[match_file(&root, "b", "A.txt", "B.txt")],
        &["a".into()],
        false,
    )
    .unwrap();
    /* ADR 0008：小库里单项消失不需要确认，直接跟随删除进回收站。 */
    assert_eq!(outcome.trashed, 1);
    assert_eq!(outcome.blocked, 0);
    let rows = store::list(&root, 0).unwrap();
    assert_eq!(rows.len(), 1, "可见列表里只剩 b");
    assert_eq!(store::list_trash(&root).unwrap().len(), 1, "a 进了回收站");
    assert!(store::state(&root).unwrap()["ceas.file.a"].contains("missing"));
    assert!(store::state(&root).unwrap()["ceas.file.a"].contains("B.txt"), "记录仍记得它最后所在的地址");
}
#[test]
fn stale_observation_rolls_back_and_reindex_preserves_concurrent_manual_edits() {
    let root = root();
    item(&root, "a", "A.txt", b"a");
    fs::rename(root.join("A.txt"), root.join("B.txt")).unwrap();
    let matched = match_file(&root, "a", "A.txt", "B.txt");
    fs::write(root.join("B.txt"), b"new-content").unwrap();
    assert!(file_reconcile::apply(&root, &[matched], &[], false).is_err());
    assert_eq!(
        store::list(&root, 0).unwrap()[0].relative_path.as_deref(),
        Some("A.txt")
    );
    let mut stale = store::list(&root, 0).unwrap().remove(0);
    stale.relative_path = Some("B.txt".into());
    stale.hash = crate::file_hash::file(&root.join("B.txt")).unwrap();
    stale.bytes = 11;
    store::patch_metadata(
        &root,
        "a",
        "最新描述",
        "https://example.com",
        5,
        Some("example.com"),
    )
    .unwrap();
    store::replace_tags(&root, "a", &["新标签".into()]).unwrap();
    store::import_item_mode(&root, stale, &["旧标签".into()], None, true).unwrap();
    let updated = store::list(&root, 0).unwrap().remove(0);
    assert_eq!(updated.description, "最新描述");
    assert_eq!(updated.rating, 5);
    assert_eq!(store::tags(&root).unwrap()["a"], vec!["新标签"]);
}
#[test]
fn scan_keeps_normal_hidden_files_and_stops_at_nested_libraries() {
    let root = root();
    fs::write(root.join(".reference.txt"), b"normal").unwrap();
    fs::create_dir(root.join("empty")).unwrap();
    fs::create_dir_all(root.join("nested/.ceas")).unwrap();
    fs::write(root.join("nested/private.txt"), b"private").unwrap();
    let scan = library_scan::scan(&root).unwrap();
    assert_eq!(scan.entries.len(), 1);
    assert_eq!(scan.entries[0].rel_path, ".reference.txt");
    assert!(scan.folders.contains(&"empty".into()));
    assert!(scan.warnings.iter().any(|w| w.path == "nested"));
}
#[test]
fn batch_restore_preview_reserves_unique_names_before_confirmation() {
    let root = root();
    item(&root, "a", "A/同名.txt", b"first");
    item(&root, "b", "B/同名.txt", b"second");
    let ids = vec!["a".into(), "b".into()];
    file_trash::delete(&root, &ids, &task()).unwrap();
    let preview = file_trash::preview(&root, &ids, Some("恢复集")).unwrap();
    assert_eq!(preview[0].target, "恢复集/同名.txt");
    assert_eq!(preview[1].target, "恢复集/同名 (恢复 1).txt");
    assert!(preview[1].conflict);
    assert!(!root.join("恢复集").exists(), "预览不能建目录");
    // 恢复前才登记目标收藏集（对应前端恢复流程里的 ensureParent）
    crate::collection_store::test_folder(&root, "恢复集");
    file_trash::restore(&root, &ids, &task(), Some("恢复集")).unwrap();
    for row in preview {
        let stored = store::list(&root, 0)
            .unwrap()
            .into_iter()
            .find(|r| r.id == row.id)
            .unwrap();
        assert_eq!(stored.relative_path.as_deref(), Some(row.target.as_str()));
    }
}
#[cfg(windows)]
#[test]
fn native_notifications_ignore_metadata_and_detect_external_files() {
    let root = root();
    let mut watch = library_watch::Watch::new(&root);
    assert_eq!(watch.poll().mode, "native");
    fs::write(root.join(".ceas/cache-test"), b"internal").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert!(!watch.poll().changed);
    fs::write(root.join("external.txt"), b"external").unwrap();
    let mut detected = false;
    for _ in 0..50 {
        if watch.poll().changed {
            detected = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(detected);
    drop(watch);
    let moved = root.with_extension("moved");
    fs::rename(&root, &moved).unwrap();
    assert_eq!(
        file_observation::inspect(&moved.join("external.txt"))
            .unwrap()
            .size,
        8
    );
}

/* ── ADR 0008：外部删除跟随进回收站 ─────────────────────────── */

#[test]
fn not_found_follows_into_trash_but_unreadable_does_not() {
    let root = root();
    item(&root, "gone", "消失.txt", b"gone");
    item(&root, "dir", "变成目录.txt", b"dir");
    /* 一个真的不存在，一个被换成了目录（读得到路径、但不是普通文件）。 */
    fs::remove_file(root.join("消失.txt")).unwrap();
    fs::remove_file(root.join("变成目录.txt")).unwrap();
    fs::create_dir(root.join("变成目录.txt")).unwrap();

    let outcome = file_reconcile::apply(&root, &[], &["gone".into(), "dir".into()], false).unwrap();
    assert_eq!(outcome.trashed, 1, "只有 NotFound 才跟随删除");
    assert_eq!(outcome.blocked, 0);

    let visible = store::list(&root, 0).unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].id, "dir", "不可读的仍留在可见列表里等人处理");
    let trash = store::list_trash(&root).unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].id, "gone");
    assert_eq!(trash[0].description, "描述 gone", "人工信息随记录进回收站");
    assert_eq!(store::deleted_tags(&root).unwrap()["gone"], vec!["标签 gone"]);
    assert!(store::state(&root).unwrap()["ceas.file.gone"].contains("消失.txt"));
}

#[test]
fn mass_disappearance_waits_for_confirmation_then_follows() {
    let root = root();
    /* 21 项超过绝对阈值，构造「移动盘没插」的典型场面。 */
    for n in 0..21 {
        item(&root, &format!("i{n}"), &format!("图{n}.txt"), format!("v{n}").as_bytes());
    }
    let ids = (0..21).map(|n| format!("i{n}")).collect::<Vec<_>>();
    for n in 0..21 {
        fs::remove_file(root.join(format!("图{n}.txt"))).unwrap();
    }

    let blocked = file_reconcile::apply(&root, &[], &ids, false).unwrap();
    assert_eq!(blocked.blocked, 21, "超过阈值要先问一次");
    assert_eq!(blocked.trashed, 0);
    assert_eq!(store::list(&root, 0).unwrap().len(), 21, "没确认前一条都不动");
    assert!(store::state(&root).unwrap()["ceas.file.i0"].contains("missing"), "但状态要写，界面才能提示");

    let adopted = file_reconcile::apply(&root, &[], &ids, true).unwrap();
    assert_eq!(adopted.trashed, 21);
    assert_eq!(adopted.blocked, 0);
    assert_eq!(store::list(&root, 0).unwrap().len(), 0);
    assert_eq!(store::list_trash(&root).unwrap().len(), 21);
}

#[test]
fn small_library_single_deletion_does_not_ask() {
    let root = root();
    item(&root, "a", "A.txt", b"a");
    item(&root, "b", "B.txt", b"b");
    item(&root, "c", "C.txt", b"c");
    fs::remove_file(root.join("A.txt")).unwrap();
    /* 3 项删 1 项是 33%，但库太小，按比例拦就是骚扰。 */
    let outcome = file_reconcile::apply(&root, &[], &["a".into()], false).unwrap();
    assert_eq!(outcome.blocked, 0);
    assert_eq!(outcome.trashed, 1);
}

#[test]
fn purge_frees_bytes_for_app_trash_and_zero_for_disk_deleted() {
    let root = root();
    item(&root, "app", "应用删.txt", b"0123456789");
    item(&root, "disk", "磁盘删.txt", b"0123456789");
    file_trash::delete(&root, &["app".into()], &task()).unwrap();
    fs::remove_file(root.join("磁盘删.txt")).unwrap();
    file_reconcile::apply(&root, &[], &["disk".into()], false).unwrap();
    assert_eq!(store::list_trash(&root).unwrap().len(), 2);

    let purged = file_trash::purge(&root, &["app".into(), "disk".into()]).unwrap();
    assert_eq!(purged.removed, 2);
    assert_eq!(purged.bytes, 10, "应用回收有原件，释放 10 字节；磁盘删除没有原件，计 0");
    assert!(store::list_trash(&root).unwrap().is_empty());
    assert!(store::state(&root).unwrap().get("ceas.trash.app").is_none());
    assert!(store::state(&root).unwrap().get("ceas.file.disk").is_none(), "记录一并清掉");
}

#[test]
fn revive_restores_the_same_record_instead_of_creating_a_duplicate() {
    let root = root();
    item(&root, "a", "回来了.txt", b"hello");
    fs::remove_file(root.join("回来了.txt")).unwrap();
    file_reconcile::apply(&root, &[], &["a".into()], false).unwrap();
    assert!(store::list(&root, 0).unwrap().is_empty());

    /* 撤销删除：同样的字节回到同样的位置。 */
    fs::write(root.join("回来了.txt"), b"hello").unwrap();
    file_reconcile::revive(&root, "a", "回来了.txt").unwrap();

    let visible = store::list(&root, 0).unwrap();
    assert_eq!(visible.len(), 1, "复活原记录，不新增");
    assert_eq!(visible[0].id, "a");
    assert_eq!(visible[0].relative_path.as_deref(), Some("回来了.txt"));
    assert_eq!(visible[0].description, "描述 a", "人工信息原样回来");
    assert_eq!(store::tags(&root).unwrap()["a"], vec!["标签 a"]);
    assert!(store::list_trash(&root).unwrap().is_empty());
}

#[test]
fn merge_into_moves_manual_info_and_removes_the_trash_record() {
    let root = root();
    item(&root, "src", "应用删.txt", b"gone-bytes");
    item(&root, "dst", "留着.txt", b"kept-bytes");
    /* 目标上已经有人工信息：合并只能补空，不能覆盖。 */
    store::patch_metadata(&root, "dst", "目标自己的描述", "", 2, None).unwrap();
    store::replace_tags(&root, "dst", &["保留".into()]).unwrap();
    file_trash::delete(&root, &["src".into()], &task()).unwrap();

    let merged = file_trash::merge_into(&root, "src", "dst").unwrap();
    assert_eq!(merged.tags, 1, "只补上目标没有的那个标签");

    let visible = store::list(&root, 0).unwrap();
    assert_eq!(visible.len(), 1, "原记录消失，不产生第三条");
    assert_eq!(visible[0].id, "dst");
    assert_eq!(visible[0].description, "目标自己的描述", "不覆盖目标已有描述");
    assert_eq!(visible[0].rating, 4, "评分取较大值");
    let mut tags = store::tags(&root).unwrap()["dst"].clone();
    tags.sort();
    assert_eq!(tags, vec!["保留".to_string(), "标签 src".to_string()]);
    assert!(store::list_trash(&root).unwrap().is_empty());
    assert!(store::state(&root).unwrap().get("ceas.trash.src").is_none());
    assert!(!root.join("应用删.txt").exists());
}

#[test]
fn merge_into_rejects_visible_source_and_deleted_target() {
    let root = root();
    item(&root, "a", "A.txt", b"a");
    item(&root, "b", "B.txt", b"b");
    assert!(file_trash::merge_into(&root, "a", "b").is_err(), "可见项不能作为来源");
    file_trash::delete(&root, &["b".into()], &task()).unwrap();
    file_trash::delete(&root, &["a".into()], &task()).unwrap();
    assert!(file_trash::merge_into(&root, "a", "b").is_err(), "目标也在回收站里");
    assert!(file_trash::merge_into(&root, "a", "a").is_err(), "不能合并到自己");
}

/* ── §5.4 内容修改：同一条记录原地更新，解不开时给出口 ───────── */

#[test]
fn content_change_updates_the_same_record_then_can_be_accepted_as_file() {
    let root = root();
    item(&root, "a", "改过的.txt", b"v1");
    /* 内容变了：核对把记录标成 pending（下一步更新），**不新增素材**。 */
    fs::write(root.join("改过的.txt"), b"v2-but-not-decodable").unwrap();
    let matched = match_file(&root, "a", "改过的.txt", "改过的.txt");
    assert_ne!(matched.hash, matched.content_hash, "核对应该看到内容变了");
    file_reconcile::apply(&root, &[matched], &[], false).unwrap();

    let rows = store::list(&root, 0).unwrap();
    assert_eq!(rows.len(), 1, "内容变化不新建素材");
    assert_eq!(rows[0].id, "a", "复用原 id");
    assert_eq!(rows[0].description, "描述 a");
    assert!(store::state(&root).unwrap()["ceas.file.a"].contains("pending"));

    /* 更新失败、内容也解不开：落成 decode，而不是永远停在 pending。 */
    file_reconcile::mark_state(&root, "a", "decode").unwrap();
    assert!(store::state(&root).unwrap()["ceas.file.a"].contains("decode"));
    assert!(
        file_reconcile::mark_state(&root, "a", "ready").is_err(),
        "ready 只能由核对结算，不能让调用方直接写"
    );

    /* 「按普通文件保留」：哈希重算、类型降级、记录转 ready。 */
    let accepted = file_reconcile::accept_content(&root, "a").unwrap();
    assert!(accepted.changed);
    assert_eq!(
        accepted.hash,
        crate::file_hash::file(&root.join("改过的.txt")).unwrap()
    );
    let updated = store::list(&root, 0).unwrap().remove(0);
    assert_eq!(updated.hash, accepted.hash, "哈希跟着内容走");
    assert_eq!(updated.kind, "file");
    assert_eq!(updated.description, "描述 a", "整理信息不动");
    assert_eq!(updated.rating, 4);
    assert!(store::state(&root).unwrap()["ceas.file.a"].contains("ready"));
    assert_eq!(store::tags(&root).unwrap()["a"], vec!["标签 a"]);

    /* 同内容再点一次是幂等的。 */
    let again = file_reconcile::accept_content(&root, "a").unwrap();
    assert!(!again.changed);
    assert_eq!(again.hash, accepted.hash);
}
