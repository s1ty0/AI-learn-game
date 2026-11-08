import type { Metadata } from "next";
import "./globals.css";
import "@xyflow/react/dist/style.css";
import "katex/dist/katex.min.css";
import "./readability.css";
import "./adventure.css";
import "./game-interactions.css";
import "./prism-and-music.css";
import "./chapter.css";
import "./expedition.css";

export const metadata: Metadata = { title: "知行 · 迷雾群岛", description: "从一束光出发，在探索中发现 AI 的秘密。" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Some browser extensions inject attributes into body before React hydrates.
  // Keep this escape hatch on body only; mismatches in game content remain visible.
  return <html lang="zh-CN"><body suppressHydrationWarning>{children}</body></html>;
}
