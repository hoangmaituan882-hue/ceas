# ADR 0009：主窗口拖放与文件粘贴共用路径导入

日期：2026-10-29。状态：已实施，本地采集子阶段。

## 背景

主窗口原先只读取 HTML5 `File`，文件夹层级和空目录无法保留，全部落到库根。
10 §2 已确定落点跟随当前位置、侧栏指定位置优先、文件夹永不摊平、回收站不接收。
资源管理器复制文件后的粘贴必须走相同规则。

## 选项

1. HTML5 拖放递归读取目录，再通过字节接口重建目录。
2. 使用已有 Tauri 原生拖放，接收磁盘路径；Windows 粘贴读取 CF_HDROP 文件列表。
3. 新增文件系统、剪贴板插件，替换既有文件能力。

## 决定

采用 2，不新增依赖。现有 Tauri API 与 Win32 已足够，不引第二套导入管线。

- `dragDropEnabled=true`；通过已有 webview 订阅 enter/over/drop/leave，退出时注销。
  物理坐标除以实际设备缩放后命中侧栏；密度只影响布局，不充当设备缩放。
- `packages/core/acquisition.ts` 决定落点。显式侧栏目标优先；否则当前收藏集接收，
  标签/搜索/筛选落回收件箱，回收站拒绝。回收站视图中的侧栏具体收藏集仍可作为显式目标。
- 手势发生时固定目标，异步读取剪贴板不重新解释导航位置。原生端核对库会话、目标目录身份、
  当前路径和 ready 状态，失败不按旧路径重建收藏集。
- 原生 `prepare_acquisition` 遍历普通来源，拒绝目标上级、自身库、链接和嵌套资料库；
  重叠选择只处理一份，普通隐藏文件和空目录保留。目录深度安全上限为 128。
- 顶层同名目录创建带序号的新目录，保留双方，不隐式合并。文件仍走既有不可覆盖复制与完整哈希校验。
  来源始终保留；即使用户复制的是剪切文件，也不删除来源。
- Windows 只读 CF_HDROP，不清空剪贴板、不释放剪贴板拥有的 HDROP；RAII 确保关闭。
  本阶段不包含截图位图、网页图片或链接粘贴。
- 工作区显示复制目标和拒绝原因，侧栏目标用虚线环区分导航选中。输入框、可编辑区域和模态
  中的 Ctrl+V 不触发采集。导入错误留在本次库会话的问题面板，可单文件重试并打开来源文件夹。
- 浏览器开发预览仅保留文件拖入降级；检测到目录明确提示使用桌面版，不把它当空文件导入。

## 代价与边界

- 目录准备会建立目标空目录；停止后保留已建立目录及已完成素材，不递归回滚用户位置。
  原生目录准备尚无逐目录进度和中途取消协议，超大清单后续需补任务化。
- 当前图片解码与 File/URL 字节接口仍是既有 WebView 管线。准备接口只传路径和元数据，
  不据此宣称全部媒体 IPC 已改为无 buffer 或能稳定处理 2GB 视频。
- 失败重试信息属于当前库会话，重启后的完整导入任务历史仍待补。
- 3000 个合成文件的准备清单约 132ms，只包含路径遍历和目录准备，不能代表真实素材全流程导入、
  缩略图提取、内存峰值或方法二的最终性能验收。
- [Tauri 官方 API](https://v2.tauri.app/reference/javascript/api/namespacewebview/#ondragdropevent)
  提醒调试器可能影响 Windows 拖放坐标。本轮验证使用受控拖放事件；资源管理器实际鼠标拖放需人工补验。
- 托盘/单实例/关闭到托盘、拖出/复制/导出、截图采集及服务器不属于本子阶段。

## 证据

- `pnpm test:storage`：61 项原生测试，含 4 项路径准备与 1 项 Windows HDROP Unicode 读取测试。
  测试自己分配 DROPFILES 内存，通过系统 DragQueryFileW 读取，不改系统剪贴板。
- `pnpm test:acquisition`：落点规则 2 项；其余模型回归另按根脚本运行。
- `pnpm check:acquisition-ui`：12 组共享 Rust/SQLite 联调，拖放事件和剪贴板路径为受控注入。
  报告 `.cache/tmp/acquisition-latest.json`。
- `pnpm check:acquisition-native`：真实 Tauri/WebView2 的生产事件订阅、IPC、原件与归属、过期会话拒绝、
  明暗三密度反馈；没有注入原生存储桥接。报告 `.cache/tmp/acquisition-native-latest.json`。
  该脚本需预先用隔离的 5174 devUrl/隐藏主窗口配置编译 debug exe，不连接用户窗口。
- 截图 `.cache/shots/acquisition-native-drop.png`、`acquisition-native-dark-airy.png`。
- 文件协调 13 组、目录管理 8 组、查询工具 8 组回归通过；纯 TS 模型合计 26 项通过。
  类型、设计与路径守卫、Rust/前端构建通过。产物主 JS 499.78KB（gzip 162.52KB）、
  webview JS 17.39KB（gzip 3.89KB）、CSS 42.94KB（gzip 7.75KB）；只记录，不作门槛。

## 原始资料

- [Microsoft：Shell Clipboard Formats](https://learn.microsoft.com/en-us/windows/win32/shell/clipboard)
- [Microsoft：DragQueryFileW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-dragqueryfilew)
- [Tauri：Webview 原生拖放](https://v2.tauri.app/reference/javascript/api/namespacewebview/#ondragdropevent)
