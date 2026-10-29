import { Mascot } from "@ceas/ui/mascot/mascot";
import "@ceas/ui/mascot/mascot.css";

/* ══ 空态 ════════════════════════════════════════════════════
   规范 v2 §8：一句话 + 一个动作，不配插画。
   吉祥物是允许出现的六个位置之一，这里让它直视前方眨眼。
   ------------------------------------------------------------ */

export function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="empty">
      <Mascot size={96} idle />
      <p className="empty-title">这里还空着</p>
      <p className="empty-hint">把图片拖进来，或者从素材目录导入</p>
      <button type="button" className="empty-action" onClick={onImport}>
        导入素材
      </button>
    </div>
  );
}
