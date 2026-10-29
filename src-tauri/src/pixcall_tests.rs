use super::*;
fn fixture(name: &str) -> (PathBuf, Connection) {
    let root = std::env::temp_dir().join(format!(
        "ceas-pixcall-fixture-{}-{}-{name}",
        std::process::id(),
        NEXT_SCAN.fetch_add(1, Ordering::Relaxed)
    ));
    crate::store::validate_root(&root).unwrap();
    fs::create_dir_all(root.join(".pixcall/database")).unwrap();
    let conn = Connection::open(db_path(&root)).unwrap();
    conn.execute_batch("create table entries(id integer primary key,parent_id integer,name text,kind integer,tags text,size integer,content_type text,is_deleted integer default 0,description text,link text,rating integer,created_at text,updated_at text);
        create table tags(id integer,name text,group_id integer);
        create table tag_groups(id integer,name text,color text);
        insert into entries(id,parent_id,name,kind) values(1,-1,'Pixcall',0),(2,-1,'Trash',0),(10,1,'品牌参考',0),(11,10,'子集',0),(12,1,'空集',0);
        insert into tag_groups values(5,'风格','#ff0000');insert into tags values(6,'极简',5);
        insert into entries values(20,11,'海报.png',1,'|6|',3,'image/png',0,'保留描述','https://example.com',4,'2026-01-01 10:00:00','2026-01-02 10:00:00');
        insert into entries values(21,2,'丢弃.png',1,'',3,'image/png',0,'','',0,null,null);
        insert into entries values(22,10,'已删除.png',1,'',3,'image/png',1,'','',0,null,null);").unwrap();
    fs::create_dir_all(root.join("品牌参考/子集")).unwrap();
    fs::write(root.join("品牌参考/子集/海报.png"), b"png").unwrap();
    (root, conn)
}
#[test]
fn keeps_tree_metadata_groups_and_ignores_trash() {
    let (root, conn) = fixture("metadata");
    drop(conn);
    let before = fs::read(db_path(&root)).unwrap();
    let result = scan(&root, 0).unwrap();
    assert_eq!(result.total, 1);
    assert_eq!(result.readable, 1);
    assert_eq!(result.entries[0].rel_path, "品牌参考/子集/海报.png");
    assert_eq!(result.entries[0].rating, 4);
    assert_eq!(result.entries[0].description, "保留描述");
    assert_eq!(result.entries[0].tags, vec!["极简"]);
    assert_eq!(result.tag_groups[0].color.as_deref(), Some("#ff0000"));
    assert!(result.folders.contains(&"空集".to_string()));
    assert_eq!(fs::read(db_path(&root)).unwrap(), before);
    assert!(!db_path(&root).with_file_name("main.db-shm").exists());
}
#[test]
fn rejects_parent_cycles_orphans_and_traversal_instead_of_truncating_paths() {
    let (root, conn) = fixture("unsafe");
    conn.execute_batch("insert into entries(id,parent_id,name,kind) values(30,31,'循环甲',0),(31,30,'循环乙',0);
        insert into entries(id,parent_id,name,kind,tags,size,content_type) values(40,30,'bad.png',1,'',1,''),(41,999,'orphan.png',1,'',1,''),(42,10,'../outside.png',1,'',1,'');").unwrap();
    drop(conn);
    let result = scan(&root, 0).unwrap();
    assert_eq!(result.total, 1);
    assert!(result.warnings.len() >= 3);
}
#[test]
fn skips_descendants_of_deleted_folder_and_counts_unreadable_separately() {
    let (root, conn) = fixture("deleted");
    conn.execute("update entries set is_deleted=1 where id=10", [])
        .unwrap();
    conn.execute_batch("insert into entries(id,parent_id,name,kind,tags,size,content_type) values(50,1,'cloud.jpg',1,'',10,'image/jpeg');").unwrap();
    drop(conn);
    let result = scan(&root, 0).unwrap();
    assert_eq!(result.total, 1);
    assert_eq!(result.readable, 0);
    assert!(!result.entries[0].readable);
}
#[test]
fn snapshot_reads_committed_wal_without_touching_source() {
    let (root, conn) = fixture("wal");
    conn.pragma_update(None, "journal_mode", "WAL").unwrap();
    conn.execute_batch("insert into entries(id,parent_id,name,kind,tags,size,content_type) values(50,1,'second.txt',1,'',10,'text/plain');").unwrap();
    let wal = db_path(&root).with_file_name("main.db-wal");
    let before = fs::read(&wal).unwrap();
    let result = scan(&root, 1).unwrap();
    assert_eq!(result.total, 2);
    assert!(result.truncated);
    assert_eq!(result.entries.len(), 1);
    assert_eq!(fs::read(&wal).unwrap(), before);
}
