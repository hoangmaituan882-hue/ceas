//! IPC 与验证程序共用同一份类型及分发，不在测试里仿写存储行为。
use crate::store::{self, ItemRow};
use serde::Deserialize;
use serde_json::Value;
use std::path::Path;
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum StoreRequest {
    HiddenIds,
    Collections {
        #[serde(default)]
        trash: bool,
    },
    EnsureCollections {
        entries: Vec<crate::collection_store::Draft>,
    },
    ReconcileCollections {
        changes: Vec<crate::collection_store::Change>,
        missing: Vec<String>,
    },
    DirectoryPreview {
        id: String,
        kind: String,
        target: Option<String>,
    },
    DirectoryBegin {
        id: String,
        kind: String,
        target: Option<String>,
        task_id: String,
        expected: String,
        token: String,
    },
    DirectoryTasks {
        #[serde(default)]
        retry: bool,
    },
    CancelDirectoryTask {
        key: String,
    },
    RetargetDirectoryTask {
        key: String,
        target: String,
        #[serde(default)]
        parents: Vec<crate::collection_store::Draft>,
    },
    List,
    Trash,
    Tags,
    TrashTags,
    State,
    Stats,
    Put {
        items: Vec<ItemRow>,
    },
    ImportItem {
        item: ItemRow,
        tags: Vec<String>,
        #[serde(default)]
        source_key: Option<String>,
        #[serde(default)]
        preserve_manual: bool,
    },
    PatchMetadata {
        id: String,
        description: String,
        source_url: String,
        rating: u8,
        site: Option<String>,
    },
    Delete {
        ids: Vec<String>,
        task_id: String,
    },
    Restore {
        ids: Vec<String>,
        task_id: String,
        folder: Option<String>,
    },
    RestorePreview {
        ids: Vec<String>,
        folder: Option<String>,
    },
    Reconcile {
        matches: Vec<crate::file_reconcile::Match>,
        missing: Vec<String>,
        /// 用户已确认「这些消失项确实被删了」；未确认时超过阈值会返回 blocked
        #[serde(default)]
        adopt: bool,
    },
    Purge {
        ids: Vec<String>,
    },
    EmptyTrash,
    ReviveItem {
        id: String,
        path: String,
    },
    /// 用户显式忽略某个文件：核对不再为它报问题、也不会把它当删除
    IgnoreFile {
        id: String,
        #[serde(default)]
        ignore: bool,
    },
    /// 写入记录状态（`decode` = 内容解不开）；只用于把一次失败的更新落成可解释的事实
    MarkFileState {
        id: String,
        state: String,
    },
    /// 接受磁盘上的当前字节：哈希重算、类型降级为普通文件
    AcceptContent {
        id: String,
    },
    /// 把库外的目录收回库内，交还给这个收藏集（§5.3「重新定位」）
    RelocateCollection {
        id: String,
        source: String,
    },
    /// 把回收记录的整理信息合并到库里另一份素材上
    MergeInto {
        source: String,
        target: String,
    },
    FileTasks {
        #[serde(default)]
        retry: bool,
    },
    CancelFileTask {
        key: String,
    },
    RetargetFileTask {
        key: String,
        target: String,
    },
    HasHash {
        hash: String,
    },
    SetTags {
        id: String,
        tags: Vec<String>,
    },
    SetState {
        key: String,
        value: String,
    },
}
pub fn execute(root: &Path, request: StoreRequest) -> Result<Value, String> {
    let value = match request {
        StoreRequest::HiddenIds => serde_json::to_value(store::hidden_ids(root)?),
        StoreRequest::Collections { trash } => {
            serde_json::to_value(crate::collection_store::list(root, trash)?)
        }
        StoreRequest::EnsureCollections { entries } => {
            crate::collection_store::ensure(root, &entries)?;
            Ok(Value::Null)
        }
        StoreRequest::ReconcileCollections { changes, missing } => {
            serde_json::to_value(crate::collection_store::apply(root, &changes, &missing)?)
        }
        StoreRequest::DirectoryPreview { id, kind, target } => serde_json::to_value(
            crate::directory_operations::preview(root, &id, &kind, target.as_deref())?.0,
        ),
        StoreRequest::DirectoryBegin {
            id,
            kind,
            target,
            task_id,
            expected,
            token,
        } => {
            crate::directory_operations::begin(
                root,
                &id,
                &kind,
                target.as_deref(),
                &task_id,
                &expected,
                &token,
            )?;
            Ok(Value::Null)
        }
        StoreRequest::DirectoryTasks { retry } => {
            serde_json::to_value(crate::directory_operations::issues(root, retry)?)
        }
        StoreRequest::CancelDirectoryTask { key } => {
            crate::directory_operations::cancel(root, &key)?;
            Ok(Value::Null)
        }
        StoreRequest::RetargetDirectoryTask {
            key,
            target,
            parents,
        } => {
            crate::directory_operations::retarget(root, &key, &target, &parents)?;
            Ok(Value::Null)
        }
        StoreRequest::List => serde_json::to_value(store::list(root, 0)?),
        StoreRequest::Trash => serde_json::to_value(store::list_trash(root)?),
        StoreRequest::Tags => serde_json::to_value(store::tags(root)?),
        StoreRequest::TrashTags => serde_json::to_value(store::deleted_tags(root)?),
        StoreRequest::State => serde_json::to_value(store::state(root)?),
        StoreRequest::Stats => serde_json::to_value(store::stats(root)?),
        StoreRequest::Put { items } => serde_json::to_value(store::upsert_items(root, &items)?),
        StoreRequest::ImportItem {
            item,
            tags,
            source_key,
            preserve_manual,
        } => {
            store::import_item_mode(root, item, &tags, source_key.as_deref(), preserve_manual)?;
            Ok(Value::Null)
        }
        StoreRequest::PatchMetadata {
            id,
            description,
            source_url,
            rating,
            site,
        } => {
            store::patch_metadata(
                root,
                &id,
                &description,
                &source_url,
                rating,
                site.as_deref(),
            )?;
            Ok(Value::Null)
        }
        StoreRequest::Delete { ids, task_id } => {
            serde_json::to_value(crate::file_trash::delete(root, &ids, &task_id)?)
        }
        StoreRequest::Restore {
            ids,
            task_id,
            folder,
        } => serde_json::to_value(crate::file_trash::restore(
            root,
            &ids,
            &task_id,
            folder.as_deref(),
        )?),
        StoreRequest::RestorePreview { ids, folder } => {
            serde_json::to_value(crate::file_trash::preview(root, &ids, folder.as_deref())?)
        }
        StoreRequest::Reconcile {
            matches,
            missing,
            adopt,
        } => serde_json::to_value(crate::file_reconcile::apply(
            root, &matches, &missing, adopt,
        )?),
        StoreRequest::Purge { ids } => serde_json::to_value(crate::file_trash::purge(root, &ids)?),
        StoreRequest::EmptyTrash => serde_json::to_value(crate::file_trash::empty(root)?),
        StoreRequest::IgnoreFile { id, ignore } => {
            let key = format!("ceas.ignored.{id}");
            if ignore {
                store::set_state(root, &key, "1")?;
            } else {
                store::clear_state(root, &key)?;
            }
            Ok(Value::Null)
        }
        StoreRequest::MergeInto { source, target } => {
            serde_json::to_value(crate::file_trash::merge_into(root, &source, &target)?)
        }
        StoreRequest::MarkFileState { id, state } => {
            crate::file_reconcile::mark_state(root, &id, &state)?;
            Ok(Value::Null)
        }
        StoreRequest::AcceptContent { id } => {
            serde_json::to_value(crate::file_reconcile::accept_content(root, &id)?)
        }
        StoreRequest::RelocateCollection { id, source } => {
            serde_json::to_value(crate::collection_recover::relocate(root, &id, &source)?)
        }
        StoreRequest::ReviveItem { id, path } => {
            crate::file_reconcile::revive(root, &id, &path)?;
            Ok(Value::Null)
        }
        StoreRequest::FileTasks { retry } => {
            serde_json::to_value(crate::file_operations::issues(root, retry)?)
        }
        StoreRequest::CancelFileTask { key } => {
            crate::file_operations::cancel(root, &key)?;
            Ok(Value::Null)
        }
        StoreRequest::RetargetFileTask { key, target } => {
            crate::file_operations::retarget(root, &key, &target)?;
            Ok(Value::Null)
        }
        StoreRequest::HasHash { hash } => serde_json::to_value(store::has_hash(root, &hash)?),
        StoreRequest::SetTags { id, tags } => {
            store::replace_tags(root, &id, &tags)?;
            Ok(Value::Null)
        }
        StoreRequest::SetState { key, value } => {
            store::set_state(root, &key, &value)?;
            Ok(Value::Null)
        }
    };
    value.map_err(|e| e.to_string())
}
