import { StrictMode } from "react";
import { importUrls } from "@/data/importer";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { LibraryBoundary } from "@/components/LibraryBoundary";
import "@/styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

/* 开发态给走查脚本留一个入口（生产构建会被摇掉）。
   走查要「导入一张临时生成的大图」时用得到，避免脚本里动态 import 触发整页重载。 */
if (import.meta.env.DEV) {
  (window as unknown as { __ceas: unknown }).__ceas = { importUrls };
}

createRoot(root).render(
  <StrictMode>
    <LibraryBoundary><App /></LibraryBoundary>
  </StrictMode>,
);
