import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { callStore } from "@/data/desktop";
import {
  collectionDrafts,
  directoryTasks,
  ensureParent,
  listCollections,
  reconcileCollections,
  type CollectionRow,
  type DirectoryPreview,
  type DirectoryTask,
} from "@/data/collection-store";
import { uuidv7 } from "@/data/uuid";
import { flushRepositoryWrites } from "@/data/db";
import { trapPanelKeys, useFilePanelFocus } from "./FileStatus";
import "./library-organization.css";

type Choice = { row: CollectionRow; kind: "move" | "trash" | "restore" };

type Props = {
  root: string;
  session: string;
  initialTrash: boolean;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  /** 点收藏集名称：跳到该收藏集（由 App 负责导航与关闭抽屉） */
  onOpen?: (id: string, label: string) => void;
  /** 从侧栏右键进来时定位到该行，而不是停在列表顶部 */
  focusId?: string;
};

/* 状态词表：短、客观、不解释。
   解释放在 title 与预览里 —— 一行写一句长说明，会让人先读文字再看目录。 */
const STATE_LABEL: Record<string, string> = {
  ready: "可用",
  missing: "目录缺失",
  unreadable: "暂不可读",
};

export function CollectionManager({ root, session, initialTrash, onClose, onUpdated, onOpen, focusId }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  useFilePanelFocus(dialog);
  /* 01 §1.6：降低动效时不位移，只保留极短淡入 */
  const reduced = useReducedMotion();

  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [trash, setTrash] = useState<CollectionRow[]>([]);
  const [tasks, setTasks] = useState<DirectoryTask[]>([]);
  const [showTrash, setShowTrash] = useState(initialTrash);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<DirectoryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [visible, setVisible] = useState(100);

  const working = useRef(false);
  const choiceReturn = useRef("");
  /* 01 §6.5：小于 300ms 的操作不显示进度，否则只会闪一下 */
  const [showBusy, setShowBusy] = useState(false);
  /* 从侧栏右键进来时定位到那一行：列表可能几十行，落在顶部等于没定位。 */
  useEffect(() => {
    if (!focusId || rows.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      const row = dialog.current?.querySelector<HTMLElement>(`[data-id="${focusId}"]`);
      row?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusId, rows.length]);

  useEffect(() => {
    if (!busy) {
      setShowBusy(false);
      return;
    }
    const timer = window.setTimeout(() => setShowBusy(true), 300);
    return () => window.clearTimeout(timer);
  }, [busy]);

  const list = showTrash ? trash : rows;

  /* 焦点回到「刚操作的那一行」；没有对应行时退到第一个可用按钮。 */
  useEffect(() => {
    if (busy || !dialog.current) return;
    if (dialog.current.contains(document.activeElement)) return;
    const previous = choiceReturn.current
      ? dialog.current.querySelector<HTMLButtonElement>(
          `[data-collection-id="${choiceReturn.current}"] button:not(:disabled)`,
        )
      : null;
    const fallback = dialog.current.querySelector<HTMLButtonElement>("button:not(:disabled)");
    (previous ?? fallback)?.focus();
  }, [choice, busy]);

  const refresh = async () => {
    const [next, deleted, pending] = await Promise.all([
      listCollections(root, session),
      listCollections(root, session, true),
      directoryTasks(root, session),
    ]);
    setRows(next);
    setTrash(deleted);
    setTasks(pending);
  };

  useEffect(() => {
    let alive = true;
    void refresh()
      .catch((reason) => alive && setError(String(reason)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // 只跑一次：refresh 每次渲染都是新函数，放进依赖会无限重复
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 统一的「写前落盘 → 执行 → 刷新界面 → 通知侧栏」包装。 */
  const run = async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await flushRepositoryWrites();
      await work();
      await onUpdated();
      await refresh();
      window.dispatchEvent(new Event("ceas-folders-changed"));
    } catch (reason) {
      setError(String(reason));
      /* 失败也要回读一次：目录任务可能已经移动了文件 */
      await refresh().catch(() => {});
      await onUpdated().catch(() => {});
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  /* 层级只用来缩进，不折叠：管理面板是"看清全貌"，藏起子集反而让人找不到。 */
  const depthOf = useMemo(() => {
    const byId = new Map(list.map((row) => [row.id, row]));
    const memo = new Map<string, number>();
    const walk = (row: CollectionRow, seen: Set<string>): number => {
      const cached = memo.get(row.id);
      if (cached !== undefined) return cached;
      const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
      const depth = parent && !seen.has(row.id) ? walk(parent, new Set(seen).add(row.id)) + 1 : 0;
      const capped = Math.min(depth, 4);
      memo.set(row.id, capped);
      return capped;
    };
    for (const row of list) walk(row, new Set());
    return (row: CollectionRow) => memo.get(row.id) ?? 0;
  }, [list]);

  const choose = (row: CollectionRow, kind: Choice["kind"]) => {
    choiceReturn.current = row.id;
    setChoice({ row, kind });
    setTarget(row.path);
    setPreview(null);
    setError("");
    setNotice("");
  };

  const cancelChoice = () => {
    setChoice(null);
    setPreview(null);
  };

  const getPreview = () =>
    run(async () => {
      if (!choice) return;
      setPreview(
        await callStore<DirectoryPreview>(
          root,
          {
            action: "directory_preview",
            id: choice.row.id,
            kind: choice.kind,
            target: choice.kind === "trash" ? undefined : target,
          },
          session,
        ),
      );
    });

  const confirm = () =>
    run(async () => {
      if (!choice || !preview) return;
      /* 目标目录（父级）必须先存在且有身份，否则移动后素材无处归属 */
      if (choice.kind !== "trash") await ensureParent(root, preview.target, session);
      await callStore(
        root,
        {
          action: "directory_begin",
          id: choice.row.id,
          kind: choice.kind,
          target: preview.target,
          expected: preview.original,
          token: preview.token,
          task_id: uuidv7(),
        },
        session,
      );
      setChoice(null);
      setPreview(null);
      setNotice(
        choice.kind === "trash" ? "已移入回收区，标签和描述保留" : choice.kind === "restore" ? "已恢复，同名内容两边都保留" : "位置已更新",
      );
    });

  const close = () => {
    if (!busy) onClose();
  };

  const blocked = busy || tasks.length > 0;

  return (
    <motion.div
      className="organization-mask organization-mask--sheet"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      onPointerDown={close}
    >
      <motion.div
        ref={dialog}
        className="organization-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="管理收藏集"
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
        transition={{
          x: { type: "spring", stiffness: 320, damping: 32 },
          opacity: { duration: 0.2, ease: [0.2, 0, 0, 1] },
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => trapPanelKeys(event, close)}
      >
        {/* 复用既有 .panel-head h2（15px / 500），不另造标题字号 */}
        <header className="panel-head sheet-head">
          <h2>管理收藏集</h2>
          <button className="query-action" disabled={busy} onClick={close}>
            关闭
          </button>
        </header>

        <div className="sheet-tabs">
          <button
            className="sheet-tab"
            disabled={busy}
            aria-pressed={!showTrash}
            onClick={() => {
              setShowTrash(false);
              setChoice(null);
            }}
          >
            收藏集<span className="sheet-tab-count">{rows.length}</span>
          </button>
          <button
            className="sheet-tab"
            disabled={busy}
            aria-pressed={showTrash}
            onClick={() => {
              setShowTrash(true);
              setChoice(null);
            }}
          >
            回收站<span className="sheet-tab-count">{trash.length}</span>
          </button>
          <button
            className="sheet-aux"
            disabled={blocked}
            title="重新读取磁盘上的目录，把新增的文件夹变成收藏集；不会移动任何文件"
            onClick={() =>
              void run(async () => {
                await reconcileCollections(root, session);
                setNotice("已按磁盘目录核对");
              })
            }
          >
            核对目录
          </button>
        </div>

        <p className="sheet-hint">收藏集 = 库里的文件夹。改名、移动、恢复都不丢标签和描述。</p>

        <div className="sheet-list">
          {loading ? (
            <p className="sheet-empty" role="status">
              正在读取…
            </p>
          ) : list.length === 0 ? (
            <p className="sheet-empty" role="status">
              {showTrash ? "回收站是空的。" : "还没有收藏集。点「核对目录」可从磁盘现有文件夹建立。"}
            </p>
          ) : (
            list.slice(0, visible).map((row) => {
              const depth = depthOf(row);
              return (
                <div
                  className="file-issue sheet-row"
                  data-id={row.id}
                  data-focus={row.id === focusId || undefined}
                  key={row.id}
                  data-collection-id={row.id}
                  data-depth={depth || undefined}
                  style={{ "--depth": depth } as CSSProperties}
                  title={row.path}
                >
                  <span className="sheet-dot" data-state={showTrash ? "trash" : row.state} aria-hidden="true" />
                  {showTrash || !onOpen ? (
                    <span className="sheet-name">{row.name}</span>
                  ) : (
                    <button className="sheet-name" onClick={() => onOpen(row.id, row.name)}>
                      {row.name}
                    </button>
                  )}
                  {showTrash || row.state !== "ready" ? (
                    <span className="sheet-state">{showTrash ? "已回收" : STATE_LABEL[row.state] ?? "状态未知"}</span>
                  ) : null}
                  <span className="sheet-actions">
                    {showTrash ? (
                      <button
                        className="sheet-act"
                        disabled={blocked}
                        onClick={() => choose(row, "restore")}
                      >
                        恢复
                      </button>
                    ) : (
                      <>
                        <button
                          className="sheet-act"
                          disabled={blocked || row.state !== "ready"}
                          onClick={() => choose(row, "move")}
                        >
                          改名 / 移动
                        </button>
                        <button
                          className="sheet-act"
                          data-danger="true"
                          disabled={blocked || row.state !== "ready"}
                          onClick={() => choose(row, "trash")}
                        >
                          回收收藏集
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            })
          )}

          {!loading && visible < list.length ? (
            <button className="query-action" onClick={() => setVisible((value) => value + 100)}>
              显示更多
            </button>
          ) : null}
        </div>

        {tasks.map((task) => (
          <section className="sheet-block" key={task.key}>
            <strong>未完成的目录操作</strong>
            <p className="sheet-path">
              {task.source} → {task.target}
            </p>
            <p className="sheet-error">{task.message}</p>
            {task.cancellable ? <p className="sheet-note">暂存：{task.staging}</p> : null}
            <div className="sheet-actions sheet-actions--open">
              <button
                className="sheet-act"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setTasks(await directoryTasks(root, session, true));
                  })
                }
              >
                重试
              </button>
              {task.cancellable ? (
                <button
                  className="sheet-act"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await callStore(root, { action: "cancel_directory_task", key: task.key }, session);
                    })
                  }
                >
                  取消（尚未移动）
                </button>
              ) : null}
            </div>
            {task.retargetable ? (
              <DirectoryRetarget
                busy={busy}
                initial={task.target}
                onSubmit={(next) =>
                  void run(async () => {
                    await callStore(
                      root,
                      {
                        action: "retarget_directory_task",
                        key: task.key,
                        target: next,
                        parents: collectionDrafts(
                          next.includes("/") ? next.slice(0, next.lastIndexOf("/")) : "",
                        ),
                      },
                      session,
                    );
                  })
                }
              />
            ) : null}
          </section>
        ))}

        {choice ? (
          <section className="sheet-block">
            <strong>
              {choice.kind === "trash" ? "回收收藏集" : choice.kind === "restore" ? "恢复收藏集" : "改名 / 移动收藏集"}
            </strong>
            <p className="sheet-path">当前位置：{choice.row.path}</p>

            {choice.kind !== "trash" ? (
              <label className="query-field">
                <span>目标相对位置</span>
                <input
                  disabled={busy}
                  value={target}
                  onChange={(event) => {
                    setTarget(event.target.value);
                    setPreview(null);
                  }}
                />
              </label>
            ) : (
              <p className="sheet-note">整个文件夹（含子集与空目录）会移到库内回收区，标签和描述保留。</p>
            )}

            <div className="sheet-actions sheet-actions--open">
              <button className="sheet-act" disabled={busy} onClick={() => void getPreview()}>
                查看影响
              </button>
              <button className="sheet-act" disabled={busy} onClick={cancelChoice}>
                取消
              </button>
            </div>

            {preview ? (
              <>
                <p>
                  实际 {preview.files} 个文件 · {preview.folders} 个目录 · {preview.indexed} 项整理记录 ·{" "}
                  {(preview.bytes / 1024 / 1024).toFixed(2)} MB
                </p>
                <p className="sheet-path">
                  {choice.kind === "trash" ? "原位置" : "确认后位置"}：{preview.target}
                </p>
                {preview.conflict ? <p className="sheet-note">原地址已被占用，恢复时会保留双方。</p> : null}
                <p className="sheet-note">确认前不移动文件。</p>
                <button className="sheet-act sheet-act--primary" disabled={busy} onClick={() => void confirm()}>
                  {choice.kind === "trash" ? "确认回收" : choice.kind === "restore" ? "确认恢复" : "确认移动"}
                </button>
              </>
            ) : null}
          </section>
        ) : null}

        <footer className="sheet-foot">
          {showBusy ? <span role="status">正在处理…</span> : null}
          {notice ? <span role="status">{notice}</span> : null}
          {error ? (
            <span className="sheet-error" role="alert">
              {error}
            </span>
          ) : null}
        </footer>
      </motion.div>
    </motion.div>
  );
}

/** 目录任务改址：只负责一个输入框，避免主组件再长一截。 */
function DirectoryRetarget({
  busy,
  initial,
  onSubmit,
}: {
  busy: boolean;
  initial: string;
  onSubmit: (path: string) => void;
}) {
  const [path, setPath] = useState(initial);
  return (
    <>
      <label className="query-field">
        <span>另选恢复相对位置</span>
        <input disabled={busy} value={path} onChange={(event) => setPath(event.target.value)} />
      </label>
      <button className="sheet-act" disabled={busy || !path} onClick={() => onSubmit(path)}>
        用新位置继续
      </button>
    </>
  );
}
