import { useRef, useState } from "react";
import { trapPanelKeys, useFilePanelFocus } from "./FileStatus";
import "./library-organization.css";

/* ══ 彻底删除确认 ════════════════════════════════════════════
   二次确认必须写清**后果与收益**，不能只说"确定吗"：
   用户要知道"删了能不能恢复"和"能腾出多少空间"。
   「磁盘删除」类条目没有原件可删，体积按 0 计 —— 不能假装释放了空间。
   ------------------------------------------------------------ */

type Props = {
  /** 选中项数量；`all` 表示清空整个回收站 */
  count: number;
  all: boolean;
  /** 真正能释放的字节（只统计回收区里还有原件的项） */
  bytes: number;
  /** 其中没有原件、只清记录的项数 */
  diskOnly: number;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function TrashPurge({ count, all, bytes, diskOnly, onConfirm, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  useFilePanelFocus(dialog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="organization-mask" onPointerDown={() => { if (!busy) onClose(); }}>
      <div
        ref={dialog}
        className="organization-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={all ? "清空回收站" : "彻底删除"}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => trapPanelKeys(event, () => { if (!busy) onClose(); })}
      >
        <strong>{all ? "清空回收站？" : `彻底删除 ${count} 项？`}</strong>
        <p className="query-help">
          {all ? `将永久删除 ${count} 项，` : "这些项将从回收区移除，无法恢复；"}
          {bytes > 0 ? `同时释放 ${size(bytes)}。` : "不会释放磁盘空间。"}
          {all ? "此操作无法撤销。" : ""}
        </p>
        {diskOnly > 0 ? (
          <p className="query-help">
            其中 {diskOnly} 项是在资源管理器里删除的，磁盘上已没有原件，只清除记录。
          </p>
        ) : null}
        {error ? <p className="query-error" role="alert">{error}</p> : null}
        <div className="organization-existing">
          <button
            className="query-action"
            disabled={busy}
            onClick={() => { void confirm(); }}
          >
            {busy ? "正在删除…" : all ? "清空，无法撤销" : "彻底删除，无法撤销"}
          </button>
          <button className="query-action" disabled={busy} onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
