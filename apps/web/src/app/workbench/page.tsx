import Link from "next/link";
import { Workspace } from "@/components/workspace";

export default function Page() {
  return <><Link className="back-to-adventure" href="/">← 返回迷雾群岛</Link><Workspace /></>;
}
