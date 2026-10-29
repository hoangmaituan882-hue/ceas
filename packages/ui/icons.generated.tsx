/* 由 scripts/gen-icons.mjs 生成，不要手改。
   来源：akar-icons（MIT）· 14 个图标
   重新生成：node scripts/gen-icons.mjs */

import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** akar:Search */
export const Search = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M21 21l-4.486-4.494M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0z"></path>
  </Icon>
);

/** akar:Inbox */
export const Inbox = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M3.304 6.132A4 4 0 0 1 7.209 3h9.582a4 4 0 0 1 3.905 3.132l.147.662a23.997 23.997 0 0 1 0 10.412l-.147.662A4 4 0 0 1 16.791 21H7.21a4 4 0 0 1-3.905-3.132l-.147-.662a24 24 0 0 1 0-10.412l.147-.662z"></path><path d="M2.5 13h6.338c0 1 .973 3 3.405 3 2.433 0 3.406-2 3.406-3H21.5"></path>
  </Icon>
);

/** akar:Folder */
export const Folder = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M22 19V9a2 2 0 0 0-2-2h-6.764a2 2 0 0 1-1.789-1.106l-.894-1.788A2 2 0 0 0 8.763 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z"></path>
  </Icon>
);

/** akar:Tag */
export const Tag = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M15.244 21.366a2.164 2.164 0 0 1-3.061 0l-8.549-8.549A2.164 2.164 0 0 1 3 11.287V5.163C3 3.97 3.97 3 5.164 3h6.123c.573 0 1.124.228 1.53.634l8.549 8.549a2.164 2.164 0 0 1 0 3.061l-6.122 6.122z"></path><path d="M6.5 6.5L7 7"></path>
  </Icon>
);

/** akar:Plus */
export const Plus = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
  </Icon>
);

/** akar:ChevronRight */
export const ChevronRight = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M8 4l8 8-8 8"></path>
  </Icon>
);

/** akar:Filter */
export const Filter = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <ellipse cx="12" cy="5" rx="9" ry="2"></ellipse><path d="M3 5c0 2.23 3.871 6.674 5.856 8.805A4.197 4.197 0 0 1 10 16.657V19a2 2 0 0 0 2 2v0a2 2 0 0 0 2-2v-2.343c0-1.061.421-2.075 1.144-2.852C17.13 11.674 21 7.231 21 5"></path>
  </Icon>
);

/** akar:Sort */
export const Sort = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M6 3v18M6 3l4 4M6 3L2 7"></path><path d="M18 21V3m0 18l4-4m-4 4l-4-4"></path>
  </Icon>
);

/** akar:SortAsc */
export const SortAsc = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M6 3v18M6 3l3 3.333M6 3L3 6.333"></path><path d="M14 21h8l-1-4h-7v4z"></path><path d="M14 14h6l-1-4h-5v4z"></path><path d="M14 7h4l-1-4h-3v4z"></path>
  </Icon>
);

/** akar:SortDesc */
export const SortDesc = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M6 21V3m0 18l3-3.333M6 21l-3-3.333"></path><path d="M14 3h8l-1 4h-7V3z"></path><path d="M14 10h6l-1 4h-5v-4z"></path><path d="M14 17h4l-1 4h-3v-4z"></path>
  </Icon>
);

/** akar:Menu */
export const Menu = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M5 6h14M5 12h14M5 18h14"></path>
  </Icon>
);

/** akar:Check */
export const Check = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M4 12l6 6L20 6"></path>
  </Icon>
);

/** akar:Settings */
export const Settings = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M14 3.269C14 2.568 13.432 2 12.731 2H11.27C10.568 2 10 2.568 10 3.269v0c0 .578-.396 1.074-.935 1.286-.085.034-.17.07-.253.106-.531.23-1.162.16-1.572-.249v0a1.269 1.269 0 0 0-1.794 0L4.412 5.446a1.269 1.269 0 0 0 0 1.794v0c.41.41.48 1.04.248 1.572a7.946 7.946 0 0 0-.105.253c-.212.539-.708.935-1.286.935v0C2.568 10 2 10.568 2 11.269v1.462C2 13.432 2.568 14 3.269 14v0c.578 0 1.074.396 1.286.935.034.085.07.17.105.253.231.531.161 1.162-.248 1.572v0a1.269 1.269 0 0 0 0 1.794l1.034 1.034a1.269 1.269 0 0 0 1.794 0v0c.41-.41 1.04-.48 1.572-.249.083.037.168.072.253.106.539.212.935.708.935 1.286v0c0 .701.568 1.269 1.269 1.269h1.462c.701 0 1.269-.568 1.269-1.269v0c0-.578.396-1.074.935-1.287.085-.033.17-.068.253-.104.531-.232 1.162-.161 1.571.248v0a1.269 1.269 0 0 0 1.795 0l1.034-1.034a1.269 1.269 0 0 0 0-1.794v0c-.41-.41-.48-1.04-.249-1.572.037-.083.072-.168.106-.253.212-.539.708-.935 1.286-.935v0c.701 0 1.269-.568 1.269-1.269V11.27c0-.701-.568-1.269-1.269-1.269v0c-.578 0-1.074-.396-1.287-.935a7.755 7.755 0 0 0-.105-.253c-.23-.531-.16-1.162.249-1.572v0a1.269 1.269 0 0 0 0-1.794l-1.034-1.034a1.269 1.269 0 0 0-1.794 0v0c-.41.41-1.04.48-1.572.249a7.913 7.913 0 0 0-.253-.106C14.396 4.343 14 3.847 14 3.27v0z"></path><path d="M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"></path>
  </Icon>
);

/** akar:TrashCan */
export const TrashCan = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M4 6h16l-1.58 14.22A2 2 0 0 1 16.432 22H7.568a2 2 0 0 1-1.988-1.78L4 6z"></path><path d="M7.345 3.147A2 2 0 0 1 9.154 2h5.692a2 2 0 0 1 1.81 1.147L18 6H6l1.345-2.853z"></path><path d="M2 6h20"></path><path d="M10 11v5"></path><path d="M14 11v5"></path>
  </Icon>
);
