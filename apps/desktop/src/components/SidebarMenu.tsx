import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* ══ 侧栏收藏集右键菜单 ═══════════════════════════════════════
   单独一份，**不复用 ContextMenu**：那个绑死了"素材 + 标签"的语义
   （已应用标签、常用标签、添加标签…），硬扩成通用组件只会越改越乱。

   右键不改当前视图：网格里右键素材会顺手选中它，侧栏不这么做 ——
   右键一个收藏集却把正在看的列表换掉，是很突兀的副作用。
   ------------------------------------------------------------ */

export type SidebarMenuState = {
  /** 菜单坐标（视口坐标） */
  x: number;
  y: number;
  /** `collection:<uuid>` 或 `folder:<相对路径>` */
  id: string;
  label: string;
  /** 库内相对路径 */
  path: string;
  /** 目录状态；拿不到时按可用处理 */
  state?: string;
  depth: number;
};

type Props = {
  menu: SidebarMenuState;
  /** 浏览器预览没有文件系统能力：磁盘相关项要隐藏，而不是禁用 */
  desktop: boolean;
  /** 有未完成的目录任务时，写操作不可用 */
  blocked: boolean;
  onClose: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onNewChild: () => void;
  onRename: () => void;
  onCopyPath: () => void;
  onTrash: () => void;
};

type Item = {
  key: string;
  label: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  /** 分隔线画在它前面 */
  divider?: boolean;
};

export function SidebarMenu({
  menu,
  desktop,
  blocked,
  onClose,
  onOpen,
  onReveal,
  onNewChild,
  onRename,
  onCopyPath,
  onTrash,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const [active, setActive] = useState(0);

  /* 视口钳制：算一遍比抽公共钩子更稳 —— ContextMenu 那套里混着子菜单定位。 */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    });
  }, [menu.x, menu.y]);

  const missing = (menu.state ?? "ready") !== "ready";
  const noFiles = !desktop;
  const items: Item[] = [
    { key: "open", label: "打开", run: onOpen, shortcut: "↵" },
    {
      key: "reveal",
      label: "在资源管理器中打开",
      run: onReveal,
      disabled: noFiles || missing,
    },
    {
      key: "child",
      label: "新建子收藏集…",
      run: onNewChild,
      disabled: blocked || missing,
      divider: true,
    },
    { key: "rename", label: "改名 / 移动…", run: onRename, disabled: blocked || missing },
    { key: "copy", label: "复制路径", run: onCopyPath, disabled: noFiles },
    {
      key: "trash",
      label: "回收收藏集…",
      run: onTrash,
      disabled: blocked || missing,
      danger: true,
      divider: true,
    },
  ];

  const enabled = items.filter((item) => !item.disabled);

  /* 关闭：点别处、Esc、窗口失焦。漏掉失焦会留下一个"永远亮着"的行。 */
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current + step + enabled.length) % Math.max(enabled.length, 1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const item = enabled[active];
        if (item) {
          item.run();
          onClose();
        }
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [active, enabled, onClose]);

  /* 打开时焦点进第一项，键盘用户不必先 Tab 一圈。 */
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(".ctx-item:not(:disabled)")?.focus();
  }, []);

  const reason = missing
    ? "目录当前不可用，先「重新读取目录」"
    : blocked
      ? "有未完成的目录操作，先去处理"
      : noFiles
        ? "浏览器预览没有文件系统能力"
        : "";

  return (
    <div className="ctx" ref={box} style={{ left: pos.x, top: pos.y }} role="menu" aria-label={`收藏集 ${menu.label}`}>
      {items.map((item) => {
        const index = enabled.indexOf(item);
        return (
          <div key={item.key} className="ctx-block">
            {item.divider ? <div className="ctx-sep" role="separator" /> : null}
            <button
              type="button"
              className="ctx-item"
              role="menuitem"
              data-danger={item.danger || undefined}
              data-open={index === active && index >= 0 ? true : undefined}
              disabled={item.disabled}
              onPointerEnter={() => index >= 0 && setActive(index)}
              onClick={() => {
                item.run();
                onClose();
              }}
            >
              {item.label}
              {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
            </button>
          </div>
        );
      })}
      {reason ? <div className="ctx-reason">{reason}</div> : null}
    </div>
  );
}
