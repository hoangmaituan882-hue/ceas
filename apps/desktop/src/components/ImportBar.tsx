import { motion } from "motion/react";
import type { ImportProgress } from "@/data/importer";

/* ══ 导入进度条 ══════════════════════════════════════════════
   规范 v2 §7.5：不弹模态，胶囊内一条 4px 进度条。
   可暂停 / 取消，失败项可展开看原因。
   ------------------------------------------------------------ */

type Props = {
  progress: ImportProgress;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onClose: () => void;
};

export function ImportBar({ progress, paused, onPause, onResume, onCancel, onClose }: Props) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const finished = !progress.running;

  return (
    <motion.div
      className="import-bar"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
    >
      <div className="import-row">
        <span className="import-label">
          {finished ? progress.cancelled?"导入已停止":"导入完成" : progress.cancelled?"正在停止":paused ? "已暂停" : "正在导入"}
          <strong>
            {progress.done} / {progress.total}
          </strong>
        </span>
        <span className="import-counts">
          新增 {progress.imported} · 更新 {progress.updated} · 重复 {progress.duplicated}
          {progress.failed.length > 0 ? ` · 失败 ${progress.failed.length}` : ""}
        </span>

        <span className="import-actions">
          {finished ? (
            <button type="button" onClick={onClose}>关闭</button>
          ) : (
            <>
              {paused ? (
                <button type="button" onClick={onResume}>继续</button>
              ) : (
                <button type="button" onClick={onPause}>暂停</button>
              )}
              <button type="button" onClick={onCancel}>取消</button>
            </>
          )}
        </span>
      </div>

      <div className="import-track" aria-hidden="true">
        <div className="import-fill" style={{ width: `${pct}%` }} />
      </div>

      {progress.failed.length > 0 ? (
        <details className="import-failed">
          <summary>{progress.failed.length} 个失败</summary>
          <ul>
            {progress.failed.slice(0, 6).map((f) => (
              <li key={f.name}>
                {f.name} · {f.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </motion.div>
  );
}
