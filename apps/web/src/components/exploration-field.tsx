"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { names, type ChapterIsland } from "@/lib/chapter";

type Point = { x: number; y: number };
const START: Point = { x: 31, y: 70 };
const LIGHT: Point = { x: 50, y: 49 };
const bounds = (point: Point): Point => ({ x: Math.max(17, Math.min(83, point.x)), y: Math.max(22, Math.min(80, point.y)) });

export function ExplorationField({ children, complete, stage, enabled, onEnter, island = "mask", destination: landmark }: {
  children: ReactNode; complete: boolean; stage: number; enabled: boolean; onEnter: () => void; island?: ChapterIsland; destination?: { title: string };
}) {
  const field = useRef<HTMLDivElement>(null);
  const position = useRef<Point>(START);
  const destination = useRef<Point | null>(null);
  const enterOnArrival = useRef(false);
  const keys = useRef(new Set<string>());
  const igniteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEnterRef = useRef(onEnter); onEnterRef.current = onEnter;
  const ignitingRef = useRef(false);
  const [point, setPoint] = useState<Point>(START);
  const [target, setTarget] = useState<Point | null>(null);
  const [near, setNear] = useState(false);
  const [walking, setWalking] = useState(false);
  const [igniting, setIgniting] = useState(false);
  const [message, setMessage] = useState("");
  const [controlsReady, setControlsReady] = useState(false);

  function distance(a: Point, b: Point) {
    const rect = field.current?.getBoundingClientRect();
    return Math.hypot((a.x - b.x) * (rect?.width ?? 900) / 100, (a.y - b.y) * (rect?.height ?? 500) / 100);
  }

  function ignite() {
    if (ignitingRef.current) return;
    ignitingRef.current = true; setIgniting(true); setWalking(false); keys.current.clear(); destination.current = null;
    setTarget(null); setMessage("光正在回应你…");
    igniteTimer.current = setTimeout(() => onEnterRef.current(), 700);
  }

  function approach() {
    if (!enabled || ignitingRef.current) return;
    field.current?.focus({ preventScroll: true });
    if (distance(position.current, LIGHT) <= 75) ignite();
    else { destination.current = LIGHT; setTarget(LIGHT); enterOnArrival.current = true; setMessage("正在靠近第一束光…"); }
  }

  useEffect(() => {
    if (!enabled) {
      setControlsReady(false);
      keys.current.clear(); destination.current = null; enterOnArrival.current = false;
      if (igniteTimer.current) clearTimeout(igniteTimer.current);
      ignitingRef.current = false; setIgniting(false); setWalking(false); setTarget(null);
      return;
    }
    let frame = 0;
    let previous = performance.now();
    const controls = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyW", "KeyA", "KeyS", "KeyD"]);
    function keydown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || ignitingRef.current) return;
      const element = event.target as HTMLElement;
      if (element.isContentEditable || element.closest("input,textarea,select,dialog,details")) return;
      if (controls.has(event.code)) {
        event.preventDefault(); keys.current.add(event.code); destination.current = null; enterOnArrival.current = false; setTarget(null); setMessage("");
      } else if (["KeyE", "Space", "Enter"].includes(event.code)) {
        if (event.code !== "KeyE" && element.closest("button,a")) return;
        event.preventDefault();
        if (distance(position.current, LIGHT) <= 75) ignite();
        else setMessage("先靠近中央的光源。也可以直接点击它，光灵会自己过去。");
      }
    }
    function release() { keys.current.clear(); destination.current = null; enterOnArrival.current = false; setWalking(false); setTarget(null); }
    function keyup(event: KeyboardEvent) { keys.current.delete(event.code); }
    function visibility() { if (document.hidden) release(); }
    function tick(now: number) {
      const elapsed = Math.min((now - previous) / 1000, .04); previous = now;
      const rect = field.current?.getBoundingClientRect();
      if (rect && !ignitingRef.current && !document.hidden) {
        let dx = Number(keys.current.has("ArrowRight") || keys.current.has("KeyD")) - Number(keys.current.has("ArrowLeft") || keys.current.has("KeyA"));
        let dy = Number(keys.current.has("ArrowDown") || keys.current.has("KeyS")) - Number(keys.current.has("ArrowUp") || keys.current.has("KeyW"));
        const goal = destination.current;
        if (dx === 0 && dy === 0 && goal) {
          dx = (goal.x - position.current.x) * rect.width / 100;
          dy = (goal.y - position.current.y) * rect.height / 100;
          if (Math.hypot(dx, dy) < 7 || (enterOnArrival.current && distance(position.current, LIGHT) <= 55)) {
            destination.current = null; setTarget(null); dx = 0; dy = 0;
            if (enterOnArrival.current) { enterOnArrival.current = false; ignite(); }
          }
        }
        const magnitude = Math.hypot(dx, dy);
        if (magnitude > 0) {
          const travel = Math.min(245 * elapsed, goal && keys.current.size === 0 ? magnitude : Infinity);
          const next = bounds({ x: position.current.x + dx / magnitude * travel / rect.width * 100,
            y: position.current.y + dy / magnitude * travel / rect.height * 100 });
          position.current = next; setPoint(next); setWalking(true); setNear(distance(next, LIGHT) <= 75);
        } else setWalking(false);
      }
      frame = requestAnimationFrame(tick);
    }
    window.addEventListener("keydown", keydown); window.addEventListener("keyup", keyup);
    window.addEventListener("blur", release); document.addEventListener("visibilitychange", visibility);
    setControlsReady(true);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame); if (igniteTimer.current) clearTimeout(igniteTimer.current);
      keys.current.clear(); window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled]);

  return <div ref={field} className={`archipelago exploration-field ${near ? "near-light" : ""} ${igniting ? "is-igniting" : ""}`}
    tabIndex={0} data-controls-ready={controlsReady} aria-busy={!controlsReady} aria-label="探索区域：方向键或WASD移动，点击地面移动，靠近光后按E或空格点亮"
    onPointerDown={event => {
      if (!enabled || ignitingRef.current || (event.target as HTMLElement).closest("button,a")) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const next = bounds({ x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 });
      destination.current = next; enterOnArrival.current = false; setTarget(next); setMessage(""); event.currentTarget.focus({ preventScroll: true });
    }}>
    {children}
    <div className="light-guide-path" aria-hidden="true" />
    {target && <span className="explorer-target" style={{ left: `${target.x}%`, top: `${target.y}%` }} aria-hidden="true" />}
    <div className={`light-explorer ${walking ? "is-walking" : ""}`} data-testid="light-explorer" data-x={point.x.toFixed(2)} data-y={point.y.toFixed(2)}
      style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-label="你的光灵">
      <span className="explorer-shadow"/><span className="explorer-cape"/><span className="explorer-core"/><i/><i/><i/>
    </div>
    <button className={`beacon-entry ${complete ? "beacon-found" : ""}`} onClick={approach} aria-label={landmark ? `${complete ? "重游" : "探索"}${landmark.title}` : island === "mask" && !complete ? "探索第一束光" : `${complete ? "重游" : "探索"}${names[island]}`} disabled={igniting}>
      <span className="first-light-aura"/><span className="first-light-ray"/><span className="beacon-orbit"/>
      <span className="beacon-spire"><span className="beacon-flame"/><span className="beacon-body"/><span className="beacon-foot"/></span>
      <span className="beacon-caption"><small>{igniting ? "正在点亮" : complete ? "已发现 · 可重游" : near ? "它感应到了你" : landmark || island !== "mask" ? "新的光路" : "第一束光"}</small><strong>{landmark?.title ?? names[island]}</strong><span>{igniting ? "光正在回应…" : near ? "E / 空格 · 点亮" : complete ? "点击重游" : stage > 0 ? "继续探索" : "点击靠近"}<ArrowRight size={14}/></span></span>
    </button>
    <span className="ignition-wave" aria-hidden="true"/>
    <div className="explorer-status" aria-live="polite">{!controlsReady ? "正在唤醒光灵…" : message || (near ? "按 E 或空格，让它亮起来。" : "方向键 / WASD 移动 · 点击地面前往")}</div>
  </div>;
}
