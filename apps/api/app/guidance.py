"""Explainable navigation and scoped support. Never grants exploration or mastery."""
import hashlib
import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .expedition import expedition_state
from .guidance_content import FAMILIES, PACKS
from .intake import state as intake_state
from .models import GuidanceSession, IntakeSession, now

router = APIRouter(prefix="/api/v1/guidance")
VERSION = "guidance-v1-" + hashlib.sha256(json.dumps(PACKS, ensure_ascii=False).encode()).hexdigest()[:12]


class Action(BaseModel):
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8, max_length=120)
    action: Literal["choose", "feedback", "hint", "answer"]
    target: str = Field(min_length=1, max_length=100)
    stage: int = Field(ge=0, le=2)
    feedback: Literal["hard", "easy", "example"] | None = None
    cause: Literal["concept", "term", "operation"] | None = None
    task_id: str | None = Field(default=None, max_length=150)
    choice: int | None = Field(default=None, ge=0, le=2)


def state(session, release_id, row=None):
    expedition = expedition_state(session, release_id)
    nodes = [*expedition["first_chapter"]["nodes"], *expedition["nodes"]]
    available = [n for n in nodes if n["unlocked"] and n["stage"] < 3]
    available.sort(key=lambda n: n["kind"] == "side")
    events = row.events if row else []
    selected = next((n for e in reversed(events) for n in available if e["target"] == n["id"] and e["stage"] == n["stage"]), available[0] if available else None)
    scoped = [e for e in events if selected and e["target"] == selected["id"] and e["stage"] == selected["stage"] and e["version"] == VERSION]
    feedback = next((e for e in reversed(scoped) if e["action"] in {"feedback", "choose"}), None)
    mode = feedback.get("feedback") if feedback else None
    cause = feedback.get("cause") if feedback else None
    variant = sum(e["action"] == "feedback" and e.get("feedback") == "example" for e in scoped) % 2
    family = FAMILIES.get(selected["id"]) if selected else None
    task = None
    if family and mode and cause != "operation":
        pack = PACKS[family]
        prompt, options, correct, hint, explanation = pack["examples"][variant]
        task_id = f"{VERSION}:{selected['id']}:{selected['stage']}:{mode}:{variant}"
        hinted = any(e["action"] == "hint" and e.get("task_id") == task_id for e in scoped)
        family_events = [e for e in events if FAMILIES.get(e["target"]) == family and e["version"] == VERSION]
        exposed = any(e["action"] in {"answer", "hint"} or (e["action"] == "feedback" and e.get("feedback") in {"hard", "example"} and e.get("cause") != "operation") for e in family_events)
        task = {"id": task_id, "prompt": prompt, "options": options, "hint": hint if hinted else None,
                "bridge": pack["bridge"] if mode != "easy" else None,
                "kind": "独立选择探测" if mode == "easy" and not hinted and not exposed else "支持下练习"}
        last_answer = next((e for e in reversed(scoped) if e["action"] == "answer" and e.get("task_id") == task_id), None)
        if last_answer and last_answer["outcome"] in {"needs_check", "unknown"}:
            task["bridge"] = pack["bridge"]
    message = "先继续当前可达主线，每次只推进一个机关。探索完成不等于已经掌握。"
    if mode == "hard":
        message = {"concept":"先补一条局部关系，再回原机关；不重学整章。", "term":"先换成直白说法，再用一个小情境检查。", "operation":"先解决操作：方向键/WASD移动，点击光源靠近；进入机关后优先用有标签的控件。操作困难不记为知识薄弱。"}[cause or "concept"]
    elif mode == "easy":
        message = "先收起讲解做一个短探测。结果仅供下一步安排参考，不自动跳过先修或解锁。"
    elif mode == "example":
        message = "换一个固定小情境，只检查当前这一条关系。两个例子轮换，不算新的独立题族。"
    if mode and not family and cause != "operation":
        message += " 当前机制尚无专属补桥样本，已记录覆盖缺口；可以继续原机关，不临时编造题目。"
    profile = intake_state(session.get(IntakeSession, "local-demo"))
    if task and last_answer:
        message = ("这次判断仍待核查，先补当前关系，再回机关尝试；不据此整章降级。" if last_answer["outcome"] in {"needs_check","unknown"}
                   else "这次选择符合规则，可以回到原机关继续。已有帮助和判断留痕保留，仍不构成正式掌握。")
    domain_name = {"mask":"评估与AI","weights":"数学直觉","token":"数据理解","loss":"数学直觉"}.get(family)
    domain = next((d for d in profile["domains"] if d["name"] == domain_name), None)
    profile_note = "尚无相关入门画像证据，保留未知，不据此判不会。"
    if domain and domain["tested"]:
        profile_note = (f"画像的{domain_name}已有{domain['tested']}次探测，其中有待核查或借助线索的回答；当前用局部任务继续确认。" if any(e["outcome"] != "independent_choice" for e in domain["evidence"])
                        else f"画像的{domain_name}已有初步选择线索；当前关系仍需单独检查，不能据此跳级。")
    return {"revision": row.revision if row else 0, "version": VERSION, "release_id": release_id,
            "target": {"id":selected["id"], "title":selected["title"], "stage":selected["stage"]} if selected else None,
            "available": [{"id":n["id"], "title":n["title"], "stage":n["stage"], "optional":n["kind"] == "side"} for n in available],
            "reason": message, "profile_note": profile_note,
            "task": task, "mode":mode, "cause":cause, "mastery":"unverified",
            "history":[{k:v for k,v in e.items() if k not in {"key","hash","result"}} for e in events[-20:]]}


@router.get("")
def current(request: Request):
    with request.app.state.sessions() as session:
        return state(session, request.app.state.release_id, session.get(GuidanceSession, "local-demo"))


@router.post("/actions")
def act(body: Action, request: Request):
    digest = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    with request.app.state.sessions() as session, session.begin():
        session.execute(insert(GuidanceSession).values(id="local-demo", revision=0, events=[]).on_conflict_do_nothing())
        row = session.scalar(select(GuidanceSession).where(GuidanceSession.id == "local-demo").with_for_update())
        for event in row.events:
            if event["key"] == body.operation_key:
                if event["hash"] != digest: raise HTTPException(409, "操作键内容不一致。")
                return event["result"]
        if row.revision != body.base_revision: raise HTTPException(409, "领航记录已更新，请先读取最新建议。")
        if len(row.events) >= 1000: raise HTTPException(409, "本地样本记录已达上限，需保留历史后扩容。")
        current = state(session, request.app.state.release_id, row)
        target = next((n for n in current["available"] if n["id"] == body.target and n["stage"] == body.stage), None)
        if not target: raise HTTPException(409, "探索位置已变化或尚未开放，请读取最新建议。")
        if body.action != "choose" and current["target"]["id"] != body.target: raise HTTPException(409, "先选择这个可达探索点。")
        event = {"key":body.operation_key,"hash":digest,"action":body.action,"target":body.target,"stage":body.stage,
                 "target_title":target["title"],"version":VERSION,"release_id":request.app.state.release_id,"created_at":now().isoformat()}
        if body.action == "feedback":
            if body.feedback is None or (body.feedback == "hard" and body.cause is None): raise HTTPException(422, "请说明本步感受；过难时先区分原因。")
            event.update(feedback=body.feedback,cause=body.cause if body.feedback == "hard" else None)
        elif body.action in {"hint","answer"}:
            task = current["task"]
            if not task or task["id"] != body.task_id: raise HTTPException(409, "当前探测已变化，请读取最新内容。")
            family = FAMILIES[body.target]
            variant = int(task["id"].rsplit(":",1)[1])
            item = PACKS[family]["examples"][variant]
            event["task_id"] = task["id"]
            if body.action == "hint":
                if task["hint"]: raise HTTPException(409, "本题线索已记录。")
            else:
                event.update(choice=body.choice, outcome="unknown" if body.choice is None else "needs_check" if body.choice != item[2] else "independent_choice" if task["kind"] == "独立选择探测" else "supported_choice",
                             feedback_text=item[4],hint_used=bool(task["hint"]),prompt=task["prompt"],options=task["options"],kind=task["kind"])
        row.revision += 1
        row.events = [*row.events,event]
        result = state(session, request.app.state.release_id, row)
        row.events = [*row.events[:-1],{**event,"result":result}]
        return result
