use crate::{
    collection_store::{self, Draft},
    directory_operations as operations, file_trash, library_format, store,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(20000);
fn id() -> String {
    format!(
        "019a0000-0000-7000-8000-{:012x}",
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
fn root() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "ceas-collection-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    library_format::create(&root, &id(), "收藏集测试", false).unwrap();
    root
}
fn folder(root: &Path, path: &str) -> String {
    fs::create_dir_all(root.join(path)).unwrap();
    let parts = path.split('/').collect::<Vec<_>>();
    let entries = parts
        .iter()
        .enumerate()
        .map(|(index, _)| Draft {
            id: id(),
            path: parts[..=index].join("/"),
        })
        .collect::<Vec<_>>();
    collection_store::ensure(root, &entries).unwrap();
    collection_store::list(root, false)
        .unwrap()
        .into_iter()
        .find(|c| c.path == path)
        .unwrap()
        .id
}
fn item(root: &Path, path: &str) -> String {
    let id = id();
    fs::write(root.join(path), path.as_bytes()).unwrap();
    store::import_item(
        root,
        store::ItemRow {
            id: id.clone(),
            hash: crate::file_hash::file(&root.join(path)).unwrap(),
            name: path.rsplit('/').next().unwrap().into(),
            relative_path: Some(path.into()),
            w: 1,
            h: 1,
            bytes: path.len() as i64,
            kind: "file".into(),
            description: "人工描述".into(),
            rating: 5,
            ..Default::default()
        },
        &["保留标签".into()],
        Some(&format!("source:{id}")),
    )
    .unwrap();
    id
}
fn run(root: &Path, id: &str, kind: &str, target: Option<&str>) {
    let (preview, _) = operations::preview(root, id, kind, target).unwrap();
    operations::begin(
        root,
        id,
        kind,
        target,
        &crate::collection_tests::id(),
        &preview.original,
        &preview.token,
    )
    .unwrap();
}
#[test]
fn ancestor_trash_preserves_children_and_new_same_path_is_another_collection() {
    let root = root();
    let parent = folder(&root, "参考");
    let child = folder(&root, "参考/子集");
    let original = item(&root, "参考/子集/图.txt");
    let own = item(&root, "参考/子集/单独回收.txt");
    file_trash::delete(&root, &[own.clone()], &id()).unwrap();
    run(&root, &parent, "trash", None);
    assert!(store::list(&root, 0).unwrap().is_empty());
    assert_eq!(store::list_trash(&root).unwrap().len(), 1);
    let conn = store::open(&root).unwrap();
    assert_eq!(
        conn.query_row(
            "select count(*) from collections where deleted_seq is not null",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert!(conn
        .query_row(
            "select deleted_seq from collections where id=?1",
            [&child],
            |r| r.get::<_, Option<i64>>(0)
        )
        .unwrap()
        .is_none());
    assert!(conn
        .query_row(
            "select deleted_seq from items where id=?1",
            [&original],
            |r| r.get::<_, Option<i64>>(0)
        )
        .unwrap()
        .is_none());
    drop(conn);
    assert!(store::patch_metadata(&root, &original, "迟到", "", 1, None).is_err());
    let mut late = store::list_trash(&root).unwrap()[0].clone();
    late.id = original.clone();
    assert!(store::import_item(&root, late, &[], None).is_err());
    let replacement = folder(&root, "参考");
    assert_ne!(replacement, parent);
    let new = item(&root, "参考/图.txt");
    let (preview, _) = operations::preview(&root, &parent, "restore", None).unwrap();
    assert!(preview.conflict);
    assert_eq!(preview.target, "参考 (恢复 1)");
    run(&root, &parent, "restore", None);
    let rows = store::list(&root, 0).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().any(|r| r.id == new));
    let old = rows.iter().find(|r| r.id == original).unwrap();
    assert_eq!(old.collection_id.as_deref(), Some(child.as_str()));
    assert_eq!(
        old.relative_path.as_deref(),
        Some("参考 (恢复 1)/子集/图.txt")
    );
    assert_eq!(old.description, "人工描述");
    assert_eq!(store::tags(&root).unwrap()[&original], vec!["保留标签"]);
    assert_eq!(store::list_trash(&root).unwrap()[0].id, own);
}
#[test]
fn directory_move_and_case_only_rename_keep_ids_and_all_physical_files() {
    let root = root();
    let parent = folder(&root, "Alpha");
    let child = folder(&root, "Alpha/empty");
    fs::write(root.join("Alpha/.hidden"), b"unindexed").unwrap();
    let file = item(&root, "Alpha/a.txt");
    run(&root, &parent, "move", Some("alpha"));
    assert!(root.join("alpha/.hidden").is_file());
    assert_eq!(
        collection_store::list(&root, false)
            .unwrap()
            .into_iter()
            .find(|r| r.id == child)
            .unwrap()
            .path,
        "alpha/empty"
    );
    folder(&root, "目标");
    run(&root, &parent, "move", Some("目标/参考"));
    assert!(root.join("目标/参考/empty").is_dir());
    let row = store::list(&root, 0)
        .unwrap()
        .into_iter()
        .find(|r| r.id == file)
        .unwrap();
    assert_eq!(row.relative_path.as_deref(), Some("目标/参考/a.txt"));
    assert_eq!(row.collection_id.as_deref(), Some(parent.as_str()));
    assert!(operations::preview(&root, &parent, "move", Some("目标/参考/自己")).is_err());
    folder(&root, "已存在");
    assert!(operations::preview(&root, &parent, "move", Some("已存在")).is_err());
}
#[test]
fn preview_cancel_and_changed_confirmation_do_not_move_directories() {
    let root = root();
    let collection = folder(&root, "参考");
    item(&root, "参考/a.txt");
    let (preview, _) = operations::preview(&root, &collection, "trash", None).unwrap();
    assert!(root.join("参考/a.txt").exists());
    assert!(operations::pending(&root).unwrap().is_empty());
    fs::write(root.join("参考/b.txt"), b"added").unwrap();
    assert!(operations::begin(
        &root,
        &collection,
        "trash",
        None,
        &id(),
        &preview.original,
        &preview.token
    )
    .is_err());
    assert!(operations::pending(&root).unwrap().is_empty());
}
fn prepare(root: &Path, id: &str, kind: &str, target: Option<&str>) -> operations::Operation {
    let (_, mut op) = operations::preview(root, id, kind, target).unwrap();
    op.key = crate::collection_tests::id();
    if kind == "trash" {
        op.target = format!("trash/{}/{}", op.key, op.original);
    }
    fs::create_dir_all(root.join(".ceas/directory-operations")).unwrap();
    crate::library_registry::write_json(
        &root.join(format!(".ceas/directory-operations/{}.json", op.key)),
        &op,
    )
    .unwrap();
    op
}
#[test]
fn directory_staged_before_commit_recovers_idempotently_and_blocks_new_writes() {
    let root = root();
    let collection = folder(&root, "参考");
    let original = item(&root, "参考/a.txt");
    let op = prepare(&root, &collection, "trash", None);
    fs::create_dir_all(root.join(".ceas/directory-staging")).unwrap();
    fs::rename(
        root.join(&op.source),
        root.join(format!(".ceas/directory-staging/{}", op.key)),
    )
    .unwrap();
    assert!(crate::library_files::write_file(&root, "late.txt", b"late").is_err());
    assert!(operations::issues(&root, true).unwrap().is_empty());
    assert!(operations::issues(&root, true).unwrap().is_empty());
    assert!(store::list(&root, 0).unwrap().is_empty());
    assert!(root.join(".ceas").join(op.target).join("a.txt").is_file());
    run(&root, &collection, "restore", None);
    assert_eq!(store::list(&root, 0).unwrap()[0].id, original);
}
#[test]
fn staged_target_conflict_retargets_without_overwriting_new_folder() {
    let root = root();
    let collection = folder(&root, "参考");
    item(&root, "参考/a.txt");
    run(&root, &collection, "trash", None);
    let op = prepare(&root, &collection, "restore", Some("新位置"));
    fs::create_dir_all(root.join(".ceas/directory-staging")).unwrap();
    fs::rename(
        root.join(".ceas").join(&op.source),
        root.join(format!(".ceas/directory-staging/{}", op.key)),
    )
    .unwrap();
    fs::create_dir(root.join("新位置")).unwrap();
    fs::write(root.join("新位置/keep.txt"), b"keep").unwrap();
    let issues = operations::issues(&root, true).unwrap();
    assert_eq!(issues.len(), 1);
    assert!(issues[0].retargetable);
    assert!(!issues[0].cancellable);
    assert!(operations::cancel(&root, &op.key).is_err());
    operations::retarget(
        &root,
        &op.key,
        "恢复集/参考",
        &[Draft {
            id: id(),
            path: "恢复集".into(),
        }],
    )
    .unwrap();
    assert_eq!(fs::read(root.join("新位置/keep.txt")).unwrap(), b"keep");
    assert!(root.join("恢复集/参考/a.txt").is_file());
}
#[test]
fn prepared_source_change_can_cancel_and_nested_library_rejects_trash() {
    let root = root();
    let collection = folder(&root, "参考");
    item(&root, "参考/a.txt");
    let mut op = prepare(&root, &collection, "trash", None);
    fs::write(root.join("参考/a.txt"), b"changed").unwrap();
    assert!(operations::execute(&root, &mut op).is_err());
    assert!(operations::issues(&root, false).unwrap()[0].cancellable);
    operations::cancel(&root, &op.key).unwrap();
    assert_eq!(fs::read(root.join("参考/a.txt")).unwrap(), b"changed");
    fs::create_dir_all(root.join("参考/嵌套/.ceas")).unwrap();
    assert!(operations::preview(&root, &collection, "trash", None).is_err());
}
#[test]
fn older_database_schema_is_rejected_without_migration() {
    let root = root();
    let conn = store::open(&root).unwrap();
    conn.pragma_update(None, "user_version", 4).unwrap();
    drop(conn);
    assert!(store::open(&root).is_err());
}
#[cfg(windows)]
#[test]
fn directory_identity_survives_external_move_and_reconciliation() {
    let root = root();
    let parent = folder(&root, "原目录");
    let child = folder(&root, "原目录/子集");
    let before = collection_store::list(&root, false).unwrap();
    assert!(before.iter().all(|row| row.identity.is_some()));
    fs::rename(root.join("原目录"), root.join("新目录")).unwrap();
    assert!(
        collection_store::ensure(
            &root,
            &[Draft {
                id: id(),
                path: "新目录".into()
            }]
        )
        .is_err(),
        "外部改名尚未核对时不能重复登记同一目录身份"
    );
    let facts = crate::library_scan::scan(&root).unwrap();
    let changes = facts
        .directories
        .iter()
        .map(|fact| {
            let row = before
                .iter()
                .find(|row| row.identity == fact.identity)
                .unwrap();
            collection_store::Change {
                id: row.id.clone(),
                previous: Some(row.path.clone()),
                path: fact.path.clone(),
                parent_id: row.parent_id.clone(),
                identity: fact.identity.clone(),
            }
        })
        .collect::<Vec<_>>();
    collection_store::apply(&root, &changes, &[]).unwrap();
    let after = collection_store::list(&root, false).unwrap();
    assert_eq!(
        after.iter().find(|row| row.id == parent).unwrap().path,
        "新目录"
    );
    assert_eq!(
        after
            .iter()
            .find(|row| row.id == child)
            .unwrap()
            .parent_id
            .as_deref(),
        Some(parent.as_str())
    );
}

/* ── §5.3「重新定位」：整个收藏集目录跑到库外 ───────────────── */

#[test]
fn relocated_collection_comes_home_and_keeps_its_items() {
    let root = root();
    let target = folder(&root, "参考");
    let kept = item(&root, "参考/a.txt");
    /* 用户把整个目录拖到桌面（库外）。 */
    let outside = root
        .parent()
        .unwrap()
        .join(format!("ceas-outside-{}", id()));
    fs::rename(root.join("参考"), &outside).unwrap();
    collection_store::apply(&root, &[], &[target.clone()]).unwrap();
    assert_eq!(
        collection_store::list(&root, false)
            .unwrap()
            .into_iter()
            .find(|c| c.id == target)
            .unwrap()
            .state,
        "missing",
        "目录不在库里要标成 missing，才谈得上重新定位"
    );

    let recovered =
        crate::collection_recover::relocate(&root, &target, outside.to_str().unwrap()).unwrap();
    assert_eq!(recovered.mode, "moved");
    assert_eq!(recovered.files, 1);
    assert_eq!(recovered.target, "参考");
    assert!(root.join("参考/a.txt").is_file());
    assert!(!outside.exists(), "同盘收回是移动，不会留下第二份");
    /* 收回不清记录：条目地址没动，整理信息原样在，核对负责把状态恢复。 */
    let rows = store::list(&root, 0).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, kept);
    assert_eq!(rows[0].relative_path.as_deref(), Some("参考/a.txt"));
    assert_eq!(rows[0].description, "人工描述");
}

#[test]
fn relocate_refuses_healthy_collections_inside_paths_and_other_libraries() {
    let root = root();
    let healthy = folder(&root, "在库");
    item(&root, "在库/a.txt");
    assert!(
        crate::collection_recover::relocate(
            &root,
            &healthy,
            root.join("在库").to_str().unwrap()
        )
        .is_err(),
        "目录还在，不需要重新定位"
    );

    let gone = folder(&root, "走了");
    fs::remove_dir_all(root.join("走了")).unwrap();
    collection_store::apply(&root, &[], &[gone.clone()]).unwrap();
    assert!(
        crate::collection_recover::relocate(&root, &gone, root.join("在库").to_str().unwrap())
            .is_err(),
        "库内目录不能当成库外来源"
    );

    let other = std::env::temp_dir().join(format!("ceas-other-{}-{}", std::process::id(), id()));
    library_format::create(&other, &id(), "别的库", false).unwrap();
    assert!(
        crate::collection_recover::relocate(&root, &gone, other.to_str().unwrap()).is_err(),
        "另一个资料库不能被当成一个收藏集收回"
    );
}
