"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Volume2, VolumeX } from "lucide-react";

export function AmbientMusic() {
  const audio = useRef<HTMLAudioElement>(null);
  const fade = useRef(0);
  const intention = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(22);
  const [message, setMessage] = useState("");

  function cancelFade() { cancelAnimationFrame(fade.current); }
  function ramp(target: number, pause = false) {
    cancelFade();
    const element = audio.current; if (!element) return;
    const from = element.volume, start = performance.now();
    function step(now: number) {
      if (!element) return;
      const progress = Math.min(1, (now - start) / 500);
      element.volume = Math.max(0, Math.min(1, from + (target - from) * progress));
      if (progress < 1) fade.current = requestAnimationFrame(step);
      else if (pause && !intention.current) element.pause();
    }
    fade.current = requestAnimationFrame(step);
  }

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("learnai-music-volume") ?? 22);
      if (Number.isFinite(saved)) setVolume(Math.max(0, Math.min(60, saved)));
    } catch {}
    function hide() {
      if (!document.hidden) return;
      intention.current = false; cancelFade(); audio.current?.pause(); setPlaying(false);
    }
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); cancelFade(); audio.current?.pause(); };
  }, []);

  async function toggle() {
    const element = audio.current; if (!element) return;
    if (intention.current) { intention.current = false; setPlaying(false); ramp(0, true); return; }
    intention.current = true; setMessage(""); element.volume = 0;
    try {
      await element.play();
      if (!intention.current) { element.pause(); return; }
      setPlaying(true); ramp(volume / 100);
    } catch {
      intention.current = false; setPlaying(false); setMessage("音乐暂时没有播放，请再点一次。探索不受影响。");
    }
  }

  return <div className="ambient-music">
    <audio ref={audio} src="/audio/mist-sea-glow.wav" preload="none" loop aria-label="雾海微光背景音乐"
      onError={() => { intention.current = false; setPlaying(false); setMessage("音乐载入失败，可以继续探索。"); }} />
    <button aria-label={playing ? "暂停背景音乐" : "播放背景音乐"} aria-pressed={playing} title="雾海微光 · 轻柔环境音乐" onClick={() => { void toggle(); }}>
      {playing ? <Volume2 size={17}/> : <VolumeX size={17}/>}<span className="music-label">{playing ? "音乐开" : "音乐关"}</span>
    </button>
    <details className="music-settings"><summary aria-label="音乐设置"><ChevronDown size={13}/></summary><div>
      <strong>雾海微光</strong><p>轻柔铺底 · 稀疏钟音 · 无鼓点</p><label htmlFor="music-volume">音乐音量 <output>{volume}%</output></label>
      <input id="music-volume" type="range" min="0" max="60" value={volume} onChange={event => {
        const next = Number(event.target.value); setVolume(next);
        try { localStorage.setItem("learnai-music-volume", String(next)); } catch {}
        if (intention.current) ramp(next / 100);
      }}/><small>首次点击开启，离开标签页会暂停。</small>
    </div></details>
    {message && <span className="music-message" role="status">{message}</span>}
  </div>;
}
