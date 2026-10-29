import { motion, useIsPresent } from "motion/react";

/* ══ 批量操作条 ══════════════════════════════════════════════
   规范 v2 §6.4：选中 ≥ 2 时底部居中浮出。
   回收站视图里换成「恢复 / 彻底删除」——**没有彻底删除，回收站就只进不出**，
   删掉 20GB 空间不变，用户会认为软件在骗他（见 08 §11.2）。
   ------------------------------------------------------------ */

type Props = {
  count: number;
  onDelete: () => void;
  onCancel: () => void;
  onRestore?: () => void;
  /** 回收站视图：彻底删除选中的项 */
  onPurge?: () => void;
};

export function BatchBar({ count, onDelete, onCancel, onRestore, onPurge }: Props) {
  // 退出动画仍保留旧 props；筛选隐藏选择后，旧删除按钮必须立即失效。
  const isPresent = useIsPresent();
  const trash = Boolean(onRestore);
  return (
    <motion.div
      className="batch-bar"
      role="toolbar"
      aria-label={`已选 ${count} 张`}
      aria-hidden={!isPresent}
      inert={!isPresent}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
    >
      <span className="batch-count">已选 {count} 张</span>
      {trash ? (
        <>
          <button type="button" className="batch-btn" onClick={onRestore} disabled={!isPresent}>
            恢复
          </button>
          <button
            type="button"
            className="batch-btn danger"
            onClick={onPurge}
            disabled={!isPresent || !onPurge}
          >
            彻底删除
          </button>
        </>
      ) : (
        <button
          type="button"
          className="batch-btn danger"
          onClick={onDelete}
          disabled={!isPresent}
        >
          删除
        </button>
      )}
      <button type="button" className="batch-btn" onClick={onCancel} disabled={!isPresent}>
        取消
      </button>
    </motion.div>
  );
}
