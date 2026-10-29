use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
static NEXT: AtomicUsize = AtomicUsize::new(0);
fn fixture() -> (PathBuf, PathBuf) {
    let base = std::env::temp_dir().join(format!(
        "ceas-acquisition-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let root = base.join("library");
    fs::create_dir_all(&root).unwrap();
    crate::library_format::create(
        &root,
        "019a0000-0000-7000-8000-000000000099",
        "采集验证",
        true,
    )
    .unwrap();
    (base, root)
}
#[test]
fn folder_import_keeps_hierarchy_hidden_and_empty_and_reserves_collision() {
    let (base, root) = fixture();
    let source = base.join("海报");
    fs::create_dir_all(source.join("子/空集")).unwrap();
    fs::write(source.join("子/a.txt"), "A").unwrap();
    fs::write(source.join(".hidden.txt"), "hidden").unwrap();
    fs::create_dir(root.join("海报")).unwrap();
    fs::write(root.join("海报/keep.txt"), "untouched").unwrap();
    let plan = prepare(&root, &[source.display().to_string()], "", None).unwrap();
    assert!(plan.warnings.is_empty());
    assert_eq!(plan.sources.len(), 2);
    assert!(plan
        .sources
        .iter()
        .any(|source| source.relative_path.as_deref() == Some("海报 (1)/子/a.txt")));
    assert!(root.join("海报 (1)/子/空集").is_dir());
    assert!(plan.folders.contains(&"海报 (1)/子/空集".into()));
    assert_eq!(
        fs::read_to_string(root.join("海报/keep.txt")).unwrap(),
        "untouched"
    );
    assert!(source.join("子/a.txt").exists());
    fs::remove_dir_all(base).unwrap();
}
#[test]
fn target_identity_is_checked_before_creating_or_importing_anything() {
    let (base, root) = fixture();
    let source = base.join("a.txt");
    fs::write(&source, "A").unwrap();
    library_files::create_folder(&root, "目标").unwrap();
    let id = "019a0000-0000-7000-8000-000000000098";
    crate::collection_store::ensure(
        &root,
        &[crate::collection_store::Draft {
            id: id.into(),
            path: "目标".into(),
        }],
    )
    .unwrap();
    assert!(prepare(&root, &[source.display().to_string()], "目标", None).is_err());
    let plan = prepare(&root, &[source.display().to_string()], "目标", Some(id)).unwrap();
    assert_eq!(plan.sources[0].relative_path.as_deref(), Some("目标/a.txt"));
    assert!(!root.join("目标/a.txt").exists());
    assert!(prepare(
        &root,
        &[source.display().to_string()],
        "另一个目标",
        Some(id)
    )
    .is_err());
    fs::remove_dir_all(base).unwrap();
}
#[test]
fn overlapping_sources_are_imported_once_and_library_boundaries_are_reported() {
    let (base, root) = fixture();
    let source = base.join("来源");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("a.txt"), "A").unwrap();
    let plan = prepare(
        &root,
        &[
            source.display().to_string(),
            source.join("a.txt").display().to_string(),
            source.display().to_string(),
        ],
        "",
        None,
    )
    .unwrap();
    assert_eq!(plan.sources.len(), 1);
    let invalid = prepare(
        &root,
        &[
            root.display().to_string(),
            base.display().to_string(),
            base.join("not-found").display().to_string(),
        ],
        "",
        None,
    )
    .unwrap();
    assert!(invalid.sources.is_empty());
    assert_eq!(invalid.warnings.len(), 3);
    let nested = base.join("another");
    fs::create_dir_all(nested.join(".pixcall")).unwrap();
    fs::write(nested.join("private.txt"), "keep").unwrap();
    let plan = prepare(&root, &[nested.display().to_string()], "", None).unwrap();
    assert!(plan.sources.is_empty());
    assert!(!plan.warnings.is_empty());
    assert!(!root.join("another").exists());
    fs::remove_dir_all(base).unwrap();
}
#[test]
fn empty_directory_is_preserved_and_loose_file_keeps_inbox_semantics() {
    let (base, root) = fixture();
    let empty = base.join("空集");
    fs::create_dir(&empty).unwrap();
    let file = base.join("散文件.txt");
    fs::write(&file, "file").unwrap();
    let plan = prepare(
        &root,
        &[empty.display().to_string(), file.display().to_string()],
        "",
        None,
    )
    .unwrap();
    assert!(root.join("空集").is_dir());
    assert_eq!(plan.folders, vec!["空集"]);
    assert_eq!(plan.sources.len(), 1);
    assert!(plan.sources[0].relative_path.is_none());
    fs::remove_dir_all(base).unwrap();
}
