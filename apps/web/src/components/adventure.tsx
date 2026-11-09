"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Compass, Lightbulb, LockKeyhole, MoreHorizontal, RotateCcw, Sparkles, X } from "lucide-react";
import { ApiError, request } from "@/lib/api";
import { experiment } from "@/lib/experiment";
import { ExplorationField } from "@/components/exploration-field";
import { AmbientMusic } from "@/components/ambient-music";
import { PrismIsland, type PrismProgress } from "@/components/prism-island";
import { ChapterDiscoveries, ChapterIslandGame, ChapterMap } from "@/components/chapter-island";
import { type Chapter, type ChapterIsland } from "@/lib/chapter";
import { ExpeditionAtlas, ExpeditionDiscoveries, ExpeditionIslandGame } from "@/components/expedition-island";
import { type Expedition, type ExpeditionIsland } from "@/lib/expedition";
import { StarMap } from "@/components/star-map";
import { Intake } from "@/components/intake";
import { Guidance } from "@/components/guidance";
import { Verification } from "@/components/verification";

type Journey = {
  revision: number; stage: number; release_id: string; discovered: string[]; mastery: "unverified";
  trail: { stage: number; created_at: string; hint_used: boolean }[];
};
type Move = { base_revision: number; operation_key: string; stage: number; mask_enabled: boolean; future_value: number; reason: string | null; hint_used: boolean };
type View = "world" | "room" | "reward" | "prism" | "chapter" | "expedition" | "stars" | "intake" | "guidance" | "verification";

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="voyage-dialog" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="voyage-dialog-head"><h2>{title}</h2><button aria-label="关闭" onClick={onClose}><X size={20} /></button></div>{children}
  </dialog>;
}

export function Adventure() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [view, setView] = useState<View>("world");
  const [prism, setPrism] = useState<PrismProgress | null>(null);
  const [prismRun, setPrismRun] = useState(0);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [chapterNode, setChapterNode] = useState<"query" | "heads" | "beacon">("query");
  const [chapterRun, setChapterRun] = useState(0);
  const [expedition, setExpedition] = useState<Expedition | null>(null);
  const [expeditionIsland, setExpeditionIsland] = useState<ExpeditionIsland>("token");
  const [expeditionRun, setExpeditionRun] = useState(0);
  const [stage, setStage] = useState(0);
  const [future, setFuture] = useState(10);
  const [mask, setMask] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<"journal" | "menu" | "map" | "atlas" | null>(null);
  const [replay, setReplay] = useState(false);
  const [retryMove, setRetryMove] = useState<Move | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const drag = useRef<{ x: number; y: number; value: number; moved: boolean } | null>(null);
  const skipTowerClick = useRef(false);
  const output = experiment(mask, future).flat();

  async function sync() {
    try {
      const current = await request<Journey>("/adventure");
      setJourney(current); setStage(Math.min(current.stage, 2)); setMask(current.stage !== 2);
      setFuture(current.stage === 1 ? 30 : 10); setReason(null); setRetryMove(null); setError("");
      if (current.stage === 3) setView("world");
    }
    catch { setError("暂时连不上你的航行记录。重试后继续，已有发现仍在。"); }
  }
  useEffect(() => { void sync(); }, []);
  useEffect(() => {
    if (journey?.stage !== 3) return;
    let active = true;
    request<PrismProgress>("/adventure/prism").then(next => { if (active) setPrism(next); })
      .catch(() => { if (active) setError("新的光路还没同步。你仍可重游已发现的小岛。"); });
    return () => { active = false; };
  }, [journey?.stage]);
  async function loadChapter() {
    try { const current = await request<Chapter>("/chapter"); setChapter(current); setError(""); return current; }
    catch { setError("航图暂时未连接。已发现的小岛仍可重游，请稍后重新读取航图。"); return null; }
  }
  async function retryExploration() {
    await sync();
    if (journey?.stage !== 3) return;
    try {
      const current = await request<PrismProgress>("/adventure/prism"); setPrism(current);
      if (current.stage === 3) await loadChapter();
      if (chapter?.completed) await loadExpedition();
    } catch { setError("新的光路还没同步。已保存的探索记录仍然保留。"); }
  }
  useEffect(() => { if (prism?.stage === 3) void loadChapter(); }, [prism?.stage]);
  async function loadExpedition() {
    try { const current = await request<Expedition>("/expedition"); setExpedition(current); setError(""); return current; }
    catch { setError("群岛总览暂未同步，已保存的光路仍然保留。"); return null; }
  }
  useEffect(() => { if (chapter?.completed) void loadExpedition(); }, [chapter?.completed]);
  useEffect(() => { if (view !== "world") heading.current?.focus(); }, [view, stage]);

  useEffect(() => {
    if (view !== "room" || sheet || saving) return;
    function keydown(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || element.isContentEditable
          || element.closest("input,textarea,select,dialog,details")) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD"].includes(event.code)) {
        event.preventDefault();
        const sign = ["ArrowLeft", "ArrowDown", "KeyA"].includes(event.code) ? -1 : 1;
        setFuture(value => Math.max(0, Math.min(40, value + sign))); setFeedback(""); setReason(null);
      } else if (event.code === "Space" && stage > 0) {
        if (element.closest("button,a")) return;
        event.preventDefault(); if (!event.repeat) setMask(value => !value); setFeedback(""); setReason(null);
      } else if (event.code === "Enter") {
        if (element.closest("button,a")) return;
        event.preventDefault(); if (!event.repeat) void advance();
      } else if (stage === 2 && ["Digit1", "Digit2", "Digit3"].includes(event.code) && mask && output[2] > 10) {
        event.preventDefault(); setReason(({ Digit1: "blocked", Digit2: "distance", Digit3: "weak" } as Record<string, string>)[event.code]); setFeedback("");
      } else if (event.code === "Escape") { event.preventDefault(); setView("world"); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [view, sheet, saving, stage, future, mask, reason, journey, replay, hintUsed, retryMove]);

  function enter() {
    const next = Math.min(journey?.stage ?? 0, 2);
    const isReplay = journey?.stage === 3;
    setReplay(isReplay); setStage(isReplay ? 0 : next); setFuture(next === 1 && !isReplay ? 30 : 10);
    setMask(next !== 2 || isReplay); setReason(null); setHint(false); setHintUsed(false); setFeedback(""); setRetryMove(null); setView("room");
  }

  function enterPrism() { setPrismRun(value => value + 1); setView("prism"); }

  function enterChapter(node: ChapterIsland) {
    setSheet(null);
    if (node === "mask") enter();
    else if (node === "prism") enterPrism();
    else if (chapter?.nodes.find(item => item.id === node)?.unlocked) { setChapterNode(node); setChapterRun(value => value + 1); setView("chapter"); }
  }
  function showStars() { setSheet(null); setView("stars"); }
  async function enterGuided(id: string) {
    const fresh = await request<Expedition & {first_chapter: Chapter}>("/expedition");
    setExpedition(fresh);setChapter(fresh.first_chapter);
    const first = fresh.first_chapter.nodes.find(n=>n.id===id && n.unlocked && n.stage<3);
    const later = fresh.nodes.find(n=>n.id===id && n.unlocked && n.stage<3);
    if (!first && !later) throw new Error("Exploration changed");
    if (id === "mask") {
      const saved = await request<Journey>("/adventure");if(saved.stage>=3)throw new Error("Exploration changed");
      setJourney(saved);setStage(saved.stage);setReplay(false);setFuture(saved.stage===1?30:10);setMask(saved.stage!==2);
      setReason(null);setHint(false);setHintUsed(false);setFeedback("");setRetryMove(null);setView("room");
    } else if (id === "prism") enterPrism();
    else if (first && (first.id === "query" || first.id === "heads" || first.id === "beacon")) {setChapterNode(first.id);setChapterRun(value=>value+1);setView("chapter");}
    else if (later) {setExpeditionIsland(later.id);setExpeditionRun(value=>value+1);setView("expedition");}
  }
  function showMap() { setSheet("map"); void loadChapter(); }
  function showAtlas() { setSheet("atlas"); void loadExpedition(); }
  function enterExpedition(node: ExpeditionIsland) {
    if (!expedition?.nodes.find(item => item.id === node)?.unlocked) return;
    setSheet(null); setExpeditionIsland(node); setExpeditionRun(value => value + 1); setView("expedition");
  }

  async function advance() {
    if (saving) return;
    if (!journey) { setFeedback("机关可以先玩。存档连接恢复后，再记录这一步。"); void sync(); return; }
    if (stage === 0 && future < 20) { setFeedback("把第三座灯塔的信号再拨大一点，试试 20 或更大。"); return; }
    if (stage === 1 && mask) { setFeedback("试着打开光闸，让第三座灯塔的光也能传向前面。"); return; }
    if (stage === 1 && future < 20) { setFeedback("把第三座的信号调到 20 或更大，对比前面的变化。"); return; }
    if (stage === 2 && (!mask || output[2] <= 10)) { setFeedback("还差一点：第一座要保持 2.00，第三座要超过 10.00。试试光闸和信号的组合。"); return; }
    if (stage === 2 && reason !== "blocked") { setFeedback(reason ? "想想刚才的对比：距离没变，信号也变强了。真正改变的是哪一条光路？" : "再选出这次机关成功的原因。"); return; }
    setSaving(true); setFeedback(""); setError("");
    try {
      if (!replay) {
        const next: Move = { base_revision: journey.revision, operation_key: "", stage, mask_enabled: mask, future_value: future, reason, hint_used: hintUsed };
        const same = retryMove && JSON.stringify({ ...retryMove, operation_key: "" }) === JSON.stringify(next);
        const move = same ? retryMove : { ...next, operation_key: crypto.randomUUID() };
        setRetryMove(move);
        setJourney(await request<Journey>("/adventure/moves", move));
      }
      setRetryMove(null); setHint(false); setHintUsed(false); setReason(null);
      if (stage === 2) setView("reward");
      else { const next = stage + 1; setStage(next); setMask(next === 1); setFuture(next === 1 ? 30 : 10); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("另一处航行已更新。点击同步后，继续已保存的位置。");
      } else setError("这一步还没保存成功。机关状态已留在屏幕上，再试一次。");
    } finally { setSaving(false); }
  }

  const complete = journey?.stage === 3;
  const nextIsland = complete && prism?.unlocked;
  const focusId: ChapterIsland = prism?.stage === 3 && chapter ? chapter.next_node : nextIsland ? "prism" : "mask";
  const focusedChapter = chapter?.nodes.find(node => node.id === focusId);
  const focusComplete = focusId === "mask" ? complete : focusId === "prism" ? prism?.stage === 3 : focusedChapter?.stage === 3;
  const focusStage = focusId === "mask" ? journey?.stage ?? 0 : focusId === "prism" ? prism?.stage ?? 0 : focusedChapter?.stage ?? 0;
  const nextDestination = chapter?.completed && expedition?.unlocked ? expedition.nodes.find(node => node.id === expedition.next_node) : undefined;
  const nextSea = expedition?.chapters.find(sea => sea.id === nextDestination?.chapter);
  const titles = ["唤醒第三座灯塔", "让光越过边界", "修好这座小岛"];
  const instructions = ["拨大第三座灯塔的信号，看看前面两座会发生什么。", "打开光闸。前两座灯塔，还和刚才一样吗？", "第一座保持 2.00，同时让第三座的读数超过 10.00。"];

  return <div className={`voyage sea-${nextSea?.id ?? "information"} ${view === "world" ? "voyage-world" : "voyage-inside"}`}>
    <div className="voyage-grain" aria-hidden="true" />
    <header className="voyage-header"><Link href="/" className="voyage-brand"><Compass size={24} /><span>知行<small>迷雾群岛</small></span></Link>
      <div className="voyage-header-actions"><AmbientMusic/><button onClick={() => setSheet("journal")}><Sparkles size={17} /><span>我的发现</span>{complete && <i />}</button><button aria-label="更多" onClick={() => setSheet("menu")}><MoreHorizontal size={22} /></button></div>
    </header>

    {error && <div className="voyage-error" role="alert">{error}<button onClick={() => { void retryExploration(); }}>重新同步</button></div>}

    {view === "world" && <main className="voyage-map">
      <div className="voyage-intro"><span className="voyage-eyebrow">{nextSea ? `${nextSea.title} · ${nextSea.theme}` : chapter?.completed ? "信息之海 · 主线已连通" : "一场关于 AI 的小小冒险"}</span><h1>{expedition?.completed ? "每片海域，都有了你的光。" : nextDestination ? "前面，还有一片新的光。" : chapter?.completed ? "这一程，已经连成了一片光。" : complete ? "你让一小片世界亮了起来。" : "雾里，有一束光。"}</h1><p>{nextDestination ? expedition?.completed ? "可以回看走过的路，也可以补上还未探索的支线。" : `下一处：${nextDestination.title}。先走眼前这一步。` : chapter?.completed ? "可以回看这段航程，也可以去双镜湾探索另一种视角。" : focusId === "query" ? "权重有了轻重。下一步，找到分数的来处。" : focusId === "beacon" ? "带上发现的关系，去点亮归航的灯塔。" : nextIsland && prism.stage < 3 ? "光路已经打开。下一步，看看每束光能参与多少。" : complete ? "每个被发现的秘密，都会留在你的星图上。" : "靠近它，试着让它亮起来。"}</p></div>
      <ExplorationField key={nextDestination?.id ?? focusId} destination={nextDestination ? { title: nextDestination.title } : undefined} island={focusId} complete={nextDestination ? nextDestination.stage === 3 : !!focusComplete} stage={nextDestination?.stage ?? focusStage} enabled={!sheet} onEnter={() => nextDestination ? enterExpedition(nextDestination.id) : enterChapter(focusId)}>
        <svg className="archipelago-scenery" viewBox="0 0 1200 550" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
          <defs><radialGradient id="island-halo"><stop stopColor="#8cc8aa" stopOpacity=".23" /><stop offset="1" stopColor="#8cc8aa" stopOpacity="0" /></radialGradient><linearGradient id="island-rock" x2=".3" y2="1"><stop stopColor="#36615b" /><stop offset="1" stopColor="#142b30" /></linearGradient><linearGradient id="island-grass" x2="1" y2="1"><stop stopColor="#739079" /><stop offset="1" stopColor="#325c52" /></linearGradient></defs>
          <ellipse cx="600" cy="305" rx="330" ry="260" fill="url(#island-halo)" />
          <g className="distant-islands" opacity=".2"><path d="M115 170l90-34 76 42-65 25z" fill="#558075"/><path d="M115 170l34 65 52 40 80-97-65 25z" fill="#23433f"/><path d="M940 130l90-29 89 44-80 24z" fill="#558075"/><path d="M940 130l55 91 44 13 80-89-80 24z" fill="#23433f"/></g>
          <path d="M452 296l152-56 153 62-150 69z" fill="url(#island-grass)" />
          <path d="M452 296l31 94 63 35 37 59 24-113z" fill="#284e48" /><path d="M607 371l-24 113 73-42 55-22 46-118z" fill="url(#island-rock)" />
          <path d="M495 312l108-42 107 40-105 45z" fill="none" stroke="#95ad85" strokeOpacity=".32" />
          <path d="M586 354l-8 26 25 5-5 24" fill="none" stroke="#92a58a" strokeOpacity=".35" strokeWidth="3" />
          <g stroke="#547668" strokeWidth="3"><path d="M485 298v-33m0 9l-12-8m12 0l10-13M709 299v-26m0 9l12-13" /></g>
          <g fill="#bac9a5"><circle cx="516" cy="301" r="2"/><circle cx="689" cy="319" r="2"/><circle cx="543" cy="330" r="2"/></g>
        </svg>
        <div className="voyage-fog fog-left" aria-hidden="true" /><div className="voyage-fog fog-right" aria-hidden="true" />
        <span className="fog-marker" aria-label="尚未开放的迷雾区域"><LockKeyhole size={14} /><span>迷雾深处</span></span>
      </ExplorationField>
      <div className="voyage-world-foot"><span className="voyage-compass-rose">✧</span><p>不用看清整片海。<br /><span>先发现眼前这一点。</span></p>{complete && <button className="world-chart-button" onClick={nextDestination ? showAtlas : showMap}>{nextDestination ? "展开群岛总览" : chapter?.completed ? "查看本章成果" : "展开这一程航图"}<ArrowRight size={13}/></button>}</div>
    </main>}

    {view === "prism" && prism && <PrismIsland key={prismRun} progress={prism} onSaved={setPrism} onBack={() => setView("world")}/>}
    {view === "chapter" && chapter && <ChapterIslandGame key={chapterRun} node={chapterNode} chapter={chapter} onSaved={setChapter} onBack={() => { setView("world"); showMap(); }}/>}
    {view === "expedition" && expedition && <ExpeditionIslandGame key={expeditionRun} island={expeditionIsland} expedition={expedition} onSaved={setExpedition} onBack={() => { setView("world"); showAtlas(); }}/>}

    {view === "stars" && <StarMap onBack={() => setView("world")}/>}
    {view === "intake" && <Intake onBack={() => setView("world")}/>}
    {view === "guidance" && <Guidance onBack={()=>setView("world")} onEnter={enterGuided}/>}
    {view === "verification" && <Verification onBack={()=>setView("world")}/>}

    {view === "room" && <main className="island-room">
      <div className="room-top"><button className="voyage-back" disabled={saving} onClick={() => setView("world")}><ArrowLeft size={16} />回到群岛</button><div className="room-dots" aria-label={`机关 ${stage + 1}，共 3 步`}>{[0, 1, 2].map(n => <span key={n} className={n < stage ? "done" : n === stage ? "current" : ""}>{n < stage ? <Check size={10} /> : n + 1}</span>)}</div><span className="room-location">回声小岛</span></div>
      <div className="room-story" key={`story-${stage}`}><span className="voyage-eyebrow">{stage === 2 ? "最后一个机关" : `探索 ${stage + 1} / 3`}</span><h1 ref={heading} tabIndex={-1}>{titles[stage]}</h1><p>{instructions[stage]}</p></div>
      <section className="signal-playground" aria-label="灯塔机关">
        <svg className="signal-wires" viewBox="0 0 900 300" preserveAspectRatio="none" aria-hidden="true"><path className={mask ? "wire-closed" : "wire-open"} d="M742 170Q450-70 155 170"/><path className={mask ? "wire-closed" : "wire-open"} d="M742 180Q580 70 450 180"/><path className="wire-always" d="M155 210Q450 340 742 210"/></svg>
        {output.map((value, index) => <div key={index} className={`signal-tower tower-${index} ${index < 2 && !mask ? "receiving" : ""}`}>
          <div className="tower-reading"><span>{index === 2 ? "远处的灯塔" : index === 0 ? "第一座" : "第二座"}</span><output data-testid={`beacon-output-${index}`}>{value.toFixed(2)}</output>{stage > 0 && <small>{index < 2 ? mask ? "没有收到远处的光" : "收到了远处的光" : "正在汇聚收到的光"}</small>}</div>
          {index === 2 ? <button className="tower-art tower-interactive" aria-label="拖动或点击第三座灯塔调节信号" disabled={saving}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, value: future, moved: false }; skipTowerClick.current = false; }}
            onPointerMove={event => {
              const origin = drag.current; if (!origin) return;
              const shift = (event.clientX - origin.x) - (event.clientY - origin.y);
              if (Math.abs(shift) > 3) { origin.moved = true; setFuture(Math.max(0, Math.min(40, Math.round(origin.value + shift / 5)))); setFeedback(""); setReason(null); }
            }}
            onPointerUp={event => { skipTowerClick.current = drag.current?.moved ?? false; drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); heading.current?.focus({ preventScroll: true }); }}
            onPointerCancel={() => { drag.current = null; skipTowerClick.current = true; }}
            onClick={() => { if (skipTowerClick.current) { skipTowerClick.current = false; return; } setFuture(value => Math.min(40, value + 5)); setFeedback(""); setReason(null); }}>
            <div key={`light-${future}-${mask}`} className="tower-light signal-pulse" style={{ opacity: .4 + value / 35 }} /><div className="tower-roof"/><div className="tower-window"/><div className="tower-column"><i/><i/></div><div className="tower-base"/>
          </button> : <div className="tower-art"><div key={`light-${mask ? "blocked" : future}`} className={`tower-light ${!mask ? "signal-pulse" : ""}`} style={{ opacity: .4 + value / 35 }} /><div className="tower-roof"/><div className="tower-window"/><div className="tower-column"><i/><i/></div><div className="tower-base"/></div>}
          {index === 2 && <span className="tower-drag-hint">拖动或点击</span>}
          <span className="tower-ground" />
        </div>)}
        {stage > 0 && <button aria-label={mask ? "打开光闸" : "关闭光闸"} aria-pressed={!mask} className={`light-gate ${mask ? "gate-closed" : "gate-open"}`} disabled={saving} onClick={() => { setMask(!mask); setFeedback(""); setReason(null); }}><span>{mask ? <LockKeyhole size={21}/> : <Sparkles size={21}/>}</span>{mask ? "光闸已关" : "光闸已开"}<small>点击{mask ? "打开" : "关闭"}</small></button>}
      </section>
      <div className="signal-control"><label htmlFor="beacon-signal"><span>第三座的信号</span><strong>{future}</strong></label><input id="beacon-signal" aria-label="第三座的信号" type="range" min="0" max="40" step="1" value={future} disabled={saving} onChange={e => { setFuture(Number(e.target.value)); setFeedback(""); setReason(null); }}/><div className="signal-range"><span>弱</span><span>强</span></div></div>
      {stage === 2 && mask && output[2] > 10 && <div className="reason-puzzle"><p><Check size={15}/>两座灯都达标了！为什么第一座能保持不变？</p><div>{[{ id: "blocked", text: "光闸挡住了来自后面的光" }, { id: "distance", text: "因为两座灯塔隔得太远" }, { id: "weak", text: "因为第三座信号还不够强" }].map(item => <button key={item.id} disabled={saving} aria-pressed={reason === item.id} onClick={() => { setReason(item.id); setFeedback(""); }}>{item.text}</button>)}</div></div>}
      <div className="room-feedback" aria-live="polite">{feedback || (stage === 0 && future >= 20 ? "第三座变亮了。前面两座的读数，仍是 2.00 和 5.00。" : stage === 1 && !mask ? "同一股信号，这次传到了前面。原来光路真的会改变结果。" : "")}</div>
      <div className="room-actions"><button className="voyage-hint" onClick={() => { setHint(!hint); setHintUsed(true); }}><Lightbulb size={16}/>{hint ? "收起线索" : "一点线索"}</button><button className="voyage-primary" disabled={saving} onClick={() => { void advance(); }}>{saving ? "正在记住这一步…" : stage === 2 ? "点亮小岛" : stage === 0 ? "我发现了，继续" : "试试最后的机关"}<ArrowRight size={17}/></button></div>
      <p className="room-keyboard-guide"><kbd>← →</kbd> 调信号{stage > 0 && <><kbd>空格</kbd> 开关光闸</>}{stage === 2 && <><kbd>1–3</kbd> 选原因</>}<kbd>Enter</kbd> 继续</p>
      {hint && <p className="voyage-hint-text" role="status">{stage === 0 ? "先拨动滑块。只看灯上的三个数字，不用记名字。" : stage === 1 ? "点击灯塔上方的光闸，看看光路和读数怎样一起变化。" : "关上光闸，保护前面的灯；再把第三座的信号调大。"}</p>}
      <p className="room-save-note">{replay ? "重游不会覆盖之前的发现。" : "每通过一个机关，都会记住你的脚步。"}</p>
    </main>}

    {view === "reward" && <main className="voyage-reward"><div className="reward-emblem"><Sparkles size={42}/><span/><span/><span/></div><span className="voyage-eyebrow">发现一片新的光</span><h1 ref={heading} tabIndex={-1}>小岛，亮起来了。</h1><p className="reward-story">一条被挡住的光路，<br/>不会把后面的变化传到前面。</p><div className="discovery-card"><span>刚才的机关，在 AI 中有个名字</span><h2>因果掩码</h2><p>让当前位置只能读取自己和前面的信息。</p><small>已记录这次探索；还可以用新情境验证理解。</small></div><button className="voyage-primary" disabled={saving} onClick={() => setView("world")}>带着发现，回到群岛<ArrowRight size={17}/></button><button className="voyage-hint" onClick={() => setSheet("journal")}>看看我的发现</button></main>}

    {sheet === "menu" && <Modal title="航行选项" onClose={() => setSheet(null)}><button className="voyage-menu-link" onClick={() => { setSheet(null); setView("verification"); }}><Compass size={20}/><span>把关系讲通<small>新情境解释与量规复盘</small></span><ArrowRight size={17}/></button><button className="voyage-menu-link" onClick={() => { setSheet(null); setView("guidance"); }}><Compass size={20}/><span>下一束光<small>推荐下一步，困难先补桥</small></span><ArrowRight size={17}/></button><button className="voyage-menu-link" onClick={() => { setSheet(null); setView("intake"); }}><Compass size={20}/><span>找到我的起点<small>约10个短任务，保留未知项</small></span><ArrowRight size={17}/></button><p className="voyage-sheet-copy">探索时只看眼前。想整理思路时，再打开手记。</p><button className="voyage-menu-link" onClick={showStars}><Sparkles size={20}/><span>我的星图<small>连接已发现知识，保存自己的理解</small></span><ArrowRight size={17}/></button><button className="voyage-menu-link" onClick={showAtlas}><Sparkles size={20}/><span>群岛总览<small>更多海域、主线与支线</small></span><ArrowRight size={17}/></button><button className="voyage-menu-link" onClick={showMap}><Compass size={20}/><span>这一程的航图<small>主线、可选支线和归航终点</small></span><ArrowRight size={17}/></button><Link className="voyage-menu-link" href="/workbench"><Compass size={20}/><span>图谱手记<small>整理连接、查资料、回看旧版本</small></span><ArrowRight size={17}/></Link><button className="voyage-menu-link" onClick={() => { setSheet("journal"); }}><Sparkles size={20}/><span>我的发现<small>只保留你已经遇见的知识</small></span><ArrowRight size={17}/></button></Modal>}
    {sheet === "map" && <Modal title="这一程的航图" onClose={() => setSheet(null)}><ChapterMap chapter={chapter} onEnter={enterChapter} onRetry={() => { void loadChapter(); }}/>{chapter?.completed && <button className="voyage-secondary" onClick={showAtlas}><Sparkles size={15}/>继续航行，展开群岛</button>}</Modal>}
    {sheet === "atlas" && <Modal title="群岛总览" onClose={() => setSheet(null)}><ExpeditionAtlas expedition={expedition} onEnter={enterExpedition} onFirst={showMap} onRetry={() => { void loadExpedition(); }}/></Modal>}
    {sheet === "journal" && <Modal title="我的发现" onClose={() => setSheet(null)}>{complete ? <><div className="discovery-constellation"><span className="discovery-star">✧</span><strong>因果掩码</strong><small>信息的边界</small></div><p className="voyage-sheet-copy">你打开过光闸，也关上过光闸。你发现，切断来自后面的信息，前面的输出就不会被它改变。</p><div className="discovery-trail">{journey?.trail.map((event, index) => <p key={event.stage}><Check size={14}/><span>{titles[event.stage]}</span><time>{new Date(event.created_at).toLocaleDateString("zh-CN")}</time></p>)}</div>{prism?.stage === 3 && <div className="journal-prism"><strong>Softmax · 信息参与多少</strong><p>把分数变成和为1的权重，再按比例汇聚。</p><div>可读范围 <ArrowRight size={12}/> 权重分配 <ArrowRight size={12}/> 汇聚结果</div><small>这条连接来自本次探索，仍待迁移验证。</small></div>}<ChapterDiscoveries chapter={chapter}/><ExpeditionDiscoveries expedition={expedition} onEnter={enterExpedition}/><p className="voyage-journal-note">这是探索足迹，还需要在新情境中验证掌握。</p><button className="voyage-secondary" onClick={showStars}><Sparkles size={15}/>把发现接进我的星图</button><button className="voyage-secondary" onClick={() => { setSheet(null); enter(); }}><RotateCcw size={15}/>重游回声机关</button>{prism?.unlocked && <button className="voyage-secondary" onClick={() => { setSheet(null); enterPrism(); }}><Sparkles size={15}/>{prism.stage === 3 ? "重游分光台" : "探索分光台"}</button>}</> : <div className="empty-discoveries"><Sparkles size={34}/><p>第一束光，等你发现。</p><small>已经经过的机关会自动保存。</small></div>}</Modal>}
  </div>;
}
