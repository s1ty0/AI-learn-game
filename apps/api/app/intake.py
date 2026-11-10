from .learner_context import learner_id
import hashlib
import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from .intake_tasks import DOMAINS, SPECS, task_at
from .models import IntakeSession, now

router = APIRouter(prefix="/api/v1/intake")
VERSION = "entry-v1-" + hashlib.sha256(json.dumps(SPECS, ensure_ascii=False).encode()).hexdigest()[:12]


class Action(BaseModel):
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8, max_length=120)
    action: Literal["answer", "hint", "finish"]
    task_id: str | None = Field(default=None, max_length=100)
    choice: int | None = Field(default=None, ge=0, le=2)
    explanation: str = Field(default="", max_length=1500)


def state(row):
    events = row.events if row else []
    answers = [e["evidence"] for e in events if e["action"] == "answer"]
    task = None if row and row.finished else task_at(answers)
    public_task = None
    if task:
        public_task = {k: task[k] for k in ("id", "domain", "prompt", "options", "kind")}
        public_task["hint"] = task["hint"] if any(e["action"] == "hint" and e["task_id"] == task["id"] for e in events) else None
    domains = [{"name": name, "tested": sum(a["domain"] == name for a in answers),
                "evidence": [a for a in answers if a["domain"] == name]} for name in DOMAINS]
    early = any(a["outcome"] != "independent_choice" for a in answers if a["domain"] in DOMAINS[:2])
    if len(answers) == 10 and all(a["outcome"] == "independent_choice" for a in answers):
        recommendation = {"chapter": "information-sea", "title": "信息之海的注意力光路", "reason": "各类探测已有一致的初步线索，可从信息选择与汇聚建立联系；尚未验证的注意力先修仍需检查。"}
    elif len(answers) < 4 or early:
        recommendation = {"chapter": "representation", "title": "表征工坊", "reason": "先用切分与查表建立直观连接；未测或待验证的基础保留，必要时补桥。"}
    else:
        recommendation = {"chapter": "learning", "title": "学习山谷", "reason": "数据和误差探测已有初步线索，可尝试预测与误差实验；进入前仍核对关键能力。"}
    return {"revision": row.revision if row else 0, "version": VERSION, "status": "draft",
            "finished": bool(row and row.finished), "answered": len(answers), "total": 10,
            "task": public_task, "domains": domains, "recommendation": recommendation,
            "mastery": "unverified", "last_feedback": answers[-1]["feedback"] if answers else None}


@router.get("")
def current(request: Request):
    with request.app.state.sessions() as session:
        return state(session.get(IntakeSession, learner_id(session)))


@router.post("/actions")
def act(body: Action, request: Request):
    digest = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    with request.app.state.sessions() as session, session.begin():
        # Serialize first creation as well as subsequent writes for this local owner.
        from sqlalchemy.dialects.postgresql import insert
        session.execute(insert(IntakeSession).values(id=learner_id(session), revision=0, finished=0, events=[]).on_conflict_do_nothing())
        row = session.scalar(select(IntakeSession).where(IntakeSession.id == learner_id(session)).with_for_update())
        for event in row.events:
            if event["key"] == body.operation_key:
                if event["hash"] != digest:
                    raise HTTPException(409, "同一操作键不能提交不同内容。")
                return event["result"]
        if row.revision != body.base_revision:
            raise HTTPException(409, "画像已在另一处更新，请查看最新进度；当前输入仍保留。")
        if row.events and row.events[0]["version"] != VERSION:
            raise HTTPException(409, "探测版本已变化，旧证据保留；需要显式迁移后继续。")
        if row.finished:
            raise HTTPException(409, "本次画像已经结束，历史证据保留。")
        answers = [e["evidence"] for e in row.events if e["action"] == "answer"]
        task = task_at(answers)
        event = {"key": body.operation_key, "hash": digest, "action": body.action,
                 "task_id": body.task_id, "version": VERSION, "created_at": now().isoformat()}
        if body.action != "finish":
            if not task or task["id"] != body.task_id:
                raise HTTPException(422, "请完成当前探测，不可跳过任务顺序。")
            hinted = any(e["action"] == "hint" and e["task_id"] == task["id"] for e in row.events)
            if body.action == "hint" and hinted:
                raise HTTPException(409, "本题线索已记录，请查看最新进度。")
            if body.action == "answer":
                outcome = "unknown" if body.choice is None else "needs_check" if body.choice != task["correct"] else "supported_choice" if hinted else "independent_choice"
                event["evidence"] = {"task_id": task["id"], "domain": task["domain"], "kind": task["kind"],
                    "task_version": VERSION, "prompt": task["prompt"], "options": task["options"],
                    "choice": body.choice, "explanation": body.explanation, "hint_used": hinted,
                    "outcome": outcome, "created_at": event["created_at"], "feedback": task["explanation"]}
                if len(answers) == 9:
                    row.finished = 1
        else:
            row.finished = 1
        row.revision += 1
        row.events = [*row.events, event]
        result = state(row)
        row.events = [*row.events[:-1], {**event, "result": result}]
        return result
