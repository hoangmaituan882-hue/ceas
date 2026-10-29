use super::*;
fn root(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "ceas-folders-{}-{}-{name}",
        std::process::id(),
        NEXT_FILE.fetch_add(1, Ordering::Relaxed)
    ));
    crate::store::validate_root(&path).unwrap();
    fs::create_dir_all(&path).unwrap();
    crate::library_format::create(
        &path,
        "019a0000-0000-7000-8000-000000000031",
        "文件测试",
        true,
    )
    .unwrap();
    path
}
#[test]
fn ordinary_names_collisions_and_copies_preserve_both_files() {
    let directory = root("ordinary");
    assert_eq!(
        write_file(&directory, "品牌参考/图.png", b"first").unwrap(),
        "品牌参考/图.png"
    );
    assert_eq!(
        write_file(&directory, "品牌参考/图.png", b"second").unwrap(),
        "品牌参考/图 (1).png"
    );
    assert_eq!(
        fs::read(directory.join("品牌参考/图.png")).unwrap(),
        b"first"
    );
    assert_eq!(
        fs::read(directory.join("品牌参考/图 (1).png")).unwrap(),
        b"second"
    );
    assert_eq!(
        copy_file(
            &directory,
            &directory.join("品牌参考/图.png"),
            "品牌参考/图.png"
        )
        .unwrap(),
        "品牌参考/图.png"
    );
    assert_eq!(scan(&directory).unwrap().entries.len(), 2);
}
#[test]
fn paths_reject_escape_absolute_reserved_and_cross_platform_names() {
    for value in [
        "../x",
        "/x",
        "E:/x",
        "a//b",
        "a/../b",
        "a/CON.png",
        "a/lpt1",
        "a/b.",
        "a/b ",
        ".ceas/x",
        ".pixcall/x",
    ] {
        assert!(normalize_relative(value).is_err(), "{value}");
    }
    assert_eq!(
        normalize_relative("品牌\\参考图.png").unwrap(),
        "品牌/参考图.png"
    );
}
#[test]
fn scan_retains_empty_folders_and_ignores_application_data() {
    let directory = root("scan");
    create_folder(&directory, "空收藏集/子集").unwrap();
    fs::create_dir_all(directory.join(".pixcall")).unwrap();
    fs::write(directory.join(".pixcall/secret"), b"x").unwrap();
    fs::write(directory.join(".ceas/derived.bin"), b"index").unwrap();
    write_file(&directory, "文档/readme.txt", b"open file").unwrap();
    let result = scan(&directory).unwrap();
    assert_eq!(result.entries.len(), 1);
    assert!(result.folders.contains(&"空收藏集/子集".to_string()));
}
#[test]
fn failed_copy_leaves_no_visible_or_temporary_file() {
    let directory = root("failure");
    assert!(copy_file(&directory, &directory.join("missing"), "收藏集/失败.png").is_err());
    assert!(fs::read_dir(directory.join("收藏集"))
        .unwrap()
        .next()
        .is_none());
}
