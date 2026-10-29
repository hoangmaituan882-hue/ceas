import { useEffect } from "react";
import type { ViewMode } from "@ceas/ui/view-switcher/view-switcher";

type Options = {
  triage: boolean; settingsOpen: boolean; openId: string | null; selected: Set<string>;
  onView: (view: ViewMode) => void; onToggleSidebar: () => void; onOpen: (id: string) => void;
};

export function useLibraryShortcuts({ triage, settingsOpen, openId, selected, onView, onToggleSidebar, onOpen }: Options) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || triage || settingsOpen) return;
      const target = event.target;
      // 检索输入中的空格、方向键属于编辑操作，不能穿透到素材快捷键。
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role=dialog], [role=menu]"))) return;
      if (event.key === " " && target instanceof HTMLElement && target.closest("button:not(.cell)")) return;
      if (event.altKey && /^[1-3]$/.test(event.key)) {
        event.preventDefault();
        onView((["grid", "canvas", "infinity"] as const)[Number(event.key) - 1] ?? "grid");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        onToggleSidebar();
      }
      if (event.key === " " && !openId && selected.size === 1) {
        const [id] = selected;
        if (id) { event.preventDefault(); onOpen(id); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triage, settingsOpen, openId, selected, onView, onToggleSidebar, onOpen]);
}
