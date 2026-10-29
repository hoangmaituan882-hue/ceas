# AGENTS.md

给所有 AI 代理的入口。**先读这三份，再动代码。**

1. `docs/05-项目规范.md` —— 硬约束（目录、命名、依赖、提交、C 盘禁令）
2. `docs/01-设计规范-v2.md` —— 一切视觉值（三层结构：不变量 → 密度 → 主题）
3. `docs/00-产品技术方案-v2.md` —— 产品与架构决策

## 六条不可协商

1. **不往 C 盘写任何东西**。新终端先 `. .\scripts\env.ps1`，再 `node scripts/check-paths.mjs`。
2. **不引第二套同类依赖**（设计系统 / 图标库 / 动画引擎 / ORM）。引入前回答规范 §5 的四个问题。
3. **不写硬编码视觉值**。颜色、间距、圆角、时长只能来自 token；圆角只允许 4/6/10/18。
4. **不写时级联删除**。软删除 + `v_*_visible` 读时谓词。
5. **不扩大范围**。只做被要求的事；发现的其他问题写进交付说明。
6. **交付要带证据**。改了什么、跑了什么、结果如何。不说「应该可以」。

## 常用命令

```bash
node scripts/check-paths.mjs          # C 盘守卫，退出码 0 才算过
python scripts/gen-icons.py           # 重新生成应用图标（纯标准库）
. .\scripts\env.ps1                   # PowerShell 会话环境
```

## 目录红线

- `packages/core`：纯 TS，不碰 React / DOM / Tauri
- `packages/ui`：只有设计系统与组件，不碰业务查询
- `packages/views`：三个渲染内核，只经 `DataSource` 取数
- `src-tauri`：只做文件、解码、IPC，不含业务规则

## 图标与吉祥物

- 图标唯一出口 `packages/ui/icon.tsx`；禁止直接 import 图标包
- 吉祥物在 `packages/ui/mascot/`，只允许出现在规范 §7 列的六个位置
