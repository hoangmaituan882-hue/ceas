import { motion } from "motion/react";

/* ══ Toast ══════════════════════════════════════════════════
   规范 v2 §7.5：底部居中，白底、圆角 10、浮层阴影，含撤销文字按钮。
   ------------------------------------------------------------ */

type Props = {
  text: string;
  raised?: boolean;
  onUndo?: () => void;
};

export function Toast({ text, raised, onUndo }: Props) {
  return (
    <motion.div
      className="toast"
      data-raised={raised || undefined}
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
    >
      <span>{text}</span>
      {onUndo ? (
        <button type="button" className="toast-undo" onClick={onUndo}>
          撤销
        </button>
      ) : null}
    </motion.div>
  );
}
