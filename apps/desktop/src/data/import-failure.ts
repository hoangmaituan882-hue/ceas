/* ══ 导入失败的分类 ══════════════════════════════════════════
   `ImportProgress.failed` 里的 reason 是原样透传的英文错误
   （WebView2 的 `The source image could not be decoded.`、
   Rust 的 `os error 5`），直接摆给用户等于没解释。
   这里只做一件事：把原因收成少数几种**能对应动作**的事实。
   ------------------------------------------------------------ */

export type FailureKind = "decode" | "unreadable" | "permission" | "space" | "unknown";
export type Verdict = {
  kind: FailureKind;
  /** 给用户看的一句话，说明发生了什么（不解释实现） */
  text: string;
  /** 可落成持久状态并停止自动重试；只有「内容解不开」值得这样做 */
  state: "decode" | null;
  /** 建议的动作：换一份文件、清理空间、还是直接按普通文件保留 */
  hint: string;
};

const DECODE = /decode|解[码析]|invalid ?image|unsupported|not a supported|could not be decoded|imagebitmap|invalidstateerror|缩略图|格式不受支持/i;
const PERMISSION = /permission|access is denied|拒绝访问|eacces|eperm|os error 5\b|只读|read-only/i;
const SPACE = /no space|disk full|空间不足|enospc|os error 112/i;
const MISSING = /not found|no such file|cannot find|找不到|enoent|os error 2\b|已被移动|已被删除/i;

export function classifyImportFailure(reason: string): Verdict {
  const raw = reason.trim() || "未知原因";
  if (DECODE.test(raw)) {
    return {
      kind: "decode",
      text: "内容无法解码（文件损坏，或格式不被支持）",
      state: "decode",
      hint: "按普通文件保留，或换一份能打开的文件",
    };
  }
  if (PERMISSION.test(raw)) {
    return { kind: "permission", text: "没有读取权限，没能更新", state: null, hint: "检查文件权限后重新核对" };
  }
  if (SPACE.test(raw)) {
    return { kind: "space", text: "磁盘空间不足，更新没有写入", state: null, hint: "清理空间后重新核对" };
  }
  if (MISSING.test(raw)) {
    return { kind: "unreadable", text: "文件已经不在了，没能更新", state: null, hint: "重新核对会把这条按删除处理" };
  }
  return { kind: "unknown", text: raw, state: null, hint: "重新核对会再试一次" };
}
