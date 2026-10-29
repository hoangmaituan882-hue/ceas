use crate::{
    library_commands::{self, Request},
    library_format, library_registry,
    library_transfer::{self, Progress, Tasks},
    store,
};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
fn id() -> String {
    format!(
        "019a0000-0000-7000-8000-{:012x}",
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
fn root(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "ceas-lifecycle-{}-{}-{label}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    store::validate_root(&path).unwrap();
    fs::create_dir_all(&path).unwrap();
    path
}
#[test]
fn opening_and_reading_never_create_a_library() {
    let base = root("read");
    let plain = base.join("ordinary");
    fs::create_dir(&plain).unwrap();
    fs::write(plain.join("原件.txt"), b"file").unwrap();
    assert!(library_format::inspect(&plain).is_err());
    assert!(store::list(&plain, 0).is_err());
    assert!(!plain.join(".ceas").exists());
    let missing = base.join("missing");
    assert!(store::state(&missing).is_err());
    assert!(!missing.exists());
}
#[test]
fn create_adopt_and_nesting_have_explicit_boundaries() {
    let base = root("create");
    let existing = base.join("existing");
    fs::create_dir(&existing).unwrap();
    fs::write(existing.join("a.txt"), b"original").unwrap();
    assert!(library_format::create(&existing, &id(), "test", false).is_err());
    let lib = library_format::create(&existing, &id(), "中文名称", true).unwrap();
    assert_eq!(lib.name, "中文名称");
    assert_eq!(fs::read(existing.join("a.txt")).unwrap(), b"original");
    assert!(library_format::create(&existing.join("nested"), &id(), "nested", false).is_err());
    assert!(library_format::create(&base, &id(), "parent", true).is_err());
    assert!(library_format::create(&base.join("bad"), "not-an-id", "bad", false).is_err());
    assert!(library_format::create(&base.join("lost-adoption"), &id(), "lost", true).is_err());
    assert!(!base.join("lost-adoption").exists());
}
#[test]
fn invalid_target_keeps_current_and_aba_session_is_rejected() {
    let base = root("sessions");
    let host = library_commands::host(base.join("config")).unwrap();
    let first = id();
    let second = id();
    let a = base.join("A");
    let b = base.join("B");
    let old = {
        let mut m = host.manager.lock().unwrap();
        let a = m.create(&a, &first, "A", false).unwrap();
        m.create(&b, &second, "B", false).unwrap();
        m.activate(std::path::Path::new(&a.library.path), None)
            .unwrap();
        a
    };
    let mut m = host.manager.lock().unwrap();
    assert!(m.activate(&base.join("missing"), None).is_err());
    assert_eq!(m.active.as_ref().unwrap().info.library.id, first);
    assert!(m.checked(&old.library.path, &old.session).is_err());
    assert!(!base.join("missing").exists());
}
#[test]
fn another_process_lease_and_external_relocation_preserve_identity() {
    let base = root("relocate");
    let source = base.join("original");
    let config = base.join("config");
    let host = library_commands::host(config.clone()).unwrap();
    let lib_id = id();
    library_commands::execute(
        &host,
        Request::Create {
            path: source.to_string_lossy().into(),
            id: lib_id.clone(),
            name: "素材".into(),
            existing: false,
        },
    )
    .unwrap();
    let other = library_commands::host(base.join("other-config")).unwrap();
    assert!(library_commands::execute(
        &other,
        Request::Open {
            path: source.to_string_lossy().into()
        }
    )
    .is_err());
    drop(other);
    drop(host);
    let destination = base.join("renamed-outside");
    fs::rename(&source, &destination).unwrap();
    let reopened = library_commands::host(config).unwrap();
    assert!(reopened.manager.lock().unwrap().active.is_none());
    assert!(!source.exists());
    library_commands::execute(
        &reopened,
        Request::Relocate {
            id: lib_id.clone(),
            path: destination.to_string_lossy().into(),
        },
    )
    .unwrap();
    assert_eq!(
        reopened
            .manager
            .lock()
            .unwrap()
            .active
            .as_ref()
            .unwrap()
            .info
            .library
            .id,
        lib_id
    );
}
#[test]
fn rename_and_verified_move_keep_items_tags_and_empty_folders() {
    let base = root("move");
    let host = library_commands::host(base.join("config")).unwrap();
    let lib_id = id();
    let source = base.join("source");
    let mut m = host.manager.lock().unwrap();
    m.create(&source, &lib_id, "素材库", false).unwrap();
    fs::write(source.join("原件.txt"), b"abc").unwrap();
    fs::create_dir(source.join("空收藏集")).unwrap();
    fs::create_dir(source.join(".hidden-empty")).unwrap();
    store::import_item(
        &source,
        store::ItemRow {
            id: "item".into(),
            hash: "hash".into(),
            name: "原件.txt".into(),
            relative_path: Some("原件.txt".into()),
            w: 1,
            h: 1,
            bytes: 3,
            kind: "file".into(),
            description: "描述".into(),
            rating: 4,
            ..Default::default()
        },
        &["标签".into()],
        Some("source:1"),
    )
    .unwrap();
    assert_eq!(
        crate::file_hash::file(&source.join("原件.txt")).unwrap(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    m.name(&lib_id, "改名后的库").unwrap();
    let target = base.join("moved");
    library_transfer::transfer(&mut m, &host.tasks, &id(), &lib_id, &target, false).unwrap();
    assert!(source.join("原件.txt").exists());
    assert!(target.join("空收藏集").is_dir());
    assert!(target.join(".hidden-empty").is_dir());
    assert_eq!(store::list(&target, 0).unwrap()[0].description, "描述");
    assert_eq!(store::tags(&target).unwrap()["item"], vec!["标签"]);
    assert_eq!(library_format::inspect(&target).unwrap().name, "改名后的库");
    let renamed = base.join("root-renamed");
    library_transfer::transfer(&mut m, &host.tasks, &id(), &lib_id, &renamed, true).unwrap();
    assert!(!target.exists());
    assert_eq!(library_format::inspect(&renamed).unwrap().id, lib_id);
}
#[test]
fn published_move_recovers_when_registry_was_not_committed() {
    let base = root("recovery");
    let config = base.join("config");
    let source = base.join("source");
    let target = base.join("target");
    let lib_id = id();
    let mut m = library_registry::Manager::load(config.clone()).unwrap();
    m.create(&source, &lib_id, "recover", false).unwrap();
    drop(m);
    fs::rename(&source, &target).unwrap();
    let task = Progress {
        id: id(),
        library_id: lib_id.clone(),
        source: source.to_string_lossy().into(),
        target: target.to_string_lossy().into(),
        staging: base.join("stage").to_string_lossy().into(),
        kind: "rename".into(),
        phase: "activating".into(),
        running: true,
        bytes: 0,
        total: 0,
        files: 0,
        completed: 0,
        error: None,
    };
    library_registry::write_json(&config.join("task.json"), &task).unwrap();
    let recovered = library_registry::Manager::load(config.clone()).unwrap();
    assert_eq!(
        recovered.active.as_ref().unwrap().info.library.path,
        target.to_string_lossy()
    );
    assert_eq!(
        Tasks::load(&config)
            .progress
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .phase,
        "completed"
    );
}
#[test]
fn transfer_conflicts_do_not_touch_either_directory() {
    let base = root("conflict");
    let host = library_commands::host(base.join("config")).unwrap();
    let lib_id = id();
    let source = base.join("source");
    let existing = base.join("existing");
    fs::create_dir(&existing).unwrap();
    fs::write(existing.join("保留.txt"), b"keep").unwrap();
    let mut m = host.manager.lock().unwrap();
    m.create(&source, &lib_id, "source", false).unwrap();
    assert!(
        library_transfer::transfer(&mut m, &host.tasks, &id(), &lib_id, &existing, false).is_err()
    );
    assert_eq!(fs::read(existing.join("保留.txt")).unwrap(), b"keep");
    assert!(source.exists());
}

#[test]
fn corrupt_registry_and_task_allow_recovery_without_recreating_libraries() {
    let base = root("damaged-config");
    let config = base.join("config");
    fs::create_dir(&config).unwrap();
    fs::write(config.join("libraries.json"), b"invalid registry").unwrap();
    let manager = library_registry::Manager::load(config.clone()).unwrap();
    assert!(manager.active.is_none());
    assert!(manager.error.as_ref().unwrap().contains("备份"));
    assert_eq!(
        fs::read(config.join("libraries.json")).unwrap(),
        b"invalid registry"
    );
    assert!(fs::read_dir(&config)
        .unwrap()
        .filter_map(Result::ok)
        .any(|e| e
            .file_name()
            .to_string_lossy()
            .starts_with("libraries-recovery-")));
    fs::write(
        config.join("libraries.json"),
        b"{\"current\":null,\"libraries\":[],\"guide\":{\"step\":0,\"done\":false}}",
    )
    .unwrap();
    fs::write(config.join("task.json"), b"invalid task").unwrap();
    let manager = library_registry::Manager::load(config.clone()).unwrap();
    assert!(manager.error.as_ref().unwrap().contains("任务记录"));
    assert_eq!(fs::read(config.join("task.json")).unwrap(), b"invalid task");
}

#[test]
fn failed_registry_save_rolls_back_display_name() {
    let base = root("name-rollback");
    let config = base.join("config");
    let mut manager = library_registry::Manager::load(config.clone()).unwrap();
    let source = base.join("source");
    let library_id = id();
    manager
        .create(&source, &library_id, "原名称", false)
        .unwrap();
    // 使原子配置写入失败，检查数据库事务随之回滚。
    fs::create_dir(config.join(format!("libraries.{}.part", std::process::id()))).unwrap();
    assert!(manager.name(&library_id, "新名称").is_err());
    assert_eq!(library_format::inspect(&source).unwrap().name, "原名称");
    assert_eq!(manager.active.as_ref().unwrap().info.library.name, "原名称");
}

#[test]
fn failed_task_marker_leaves_a_terminal_task_and_original_session() {
    let base = root("marker-failure");
    let host = library_commands::host(base.join("config")).unwrap();
    let mut manager = host.manager.lock().unwrap();
    let source = base.join("source");
    let library_id = id();
    let active = manager
        .create(&source, &library_id, "source", false)
        .unwrap();
    fs::create_dir(source.join(".ceas/operation.json")).unwrap();
    assert!(library_transfer::transfer(
        &mut manager,
        &host.tasks,
        &id(),
        &library_id,
        &base.join("target"),
        false
    )
    .is_err());
    let task = host.tasks.progress.lock().unwrap();
    assert!(!task.as_ref().unwrap().running);
    assert_eq!(task.as_ref().unwrap().phase, "failed");
    assert_eq!(
        manager.active.as_ref().unwrap().info.session,
        active.session
    );
    assert!(!base.join("target").exists());
}
