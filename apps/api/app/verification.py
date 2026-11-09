import hashlib
import json
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .chapter import session_id
from .content import DEMO_GRAPH
from .models import AdventureSession, LearnerGraph, VerificationSession, ReviewCase, now
from .reviewing import projection
from .verification_content import TASKS

router = APIRouter(prefix="/api/v1/verification")
VERSION = "transfer-v1-" + hashlib.sha256(json.dumps(TASKS,ensure_ascii=False).encode()).hexdigest()[:12]


class ReviewItem(BaseModel):
    criterion: Literal["path","conditions","boundary"]
    judgement: Literal["met","partial","missing","unsure"]
    quote: str = Field(default="",max_length=1000)
    reason: str = Field(min_length=1,max_length=1000)


class Action(BaseModel):
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8,max_length=120)
    action: Literal["start","submit","self_review"]
    goal: str | None = Field(default=None,max_length=50)
    attempt_id: str | None = Field(default=None,max_length=100)
    choice: int | None = Field(default=None,ge=0,le=2)
    explanation: str = Field(default="",max_length=5000)
    used_help: bool = False
    review: list[ReviewItem] = Field(default_factory=list,max_length=3)


def state(session,row=None):
    events=row.events if row else []
    submitted={e["attempt_id"]:e for e in events if e["action"]=="submit"}
    starts=[e for e in events if e["action"]=="start"]
    active=next((e for e in reversed(starts) if e["attempt_id"] not in submitted),None)
    goals=[]
    for key,task in TASKS.items():
        progress=session.get(AdventureSession,session_id(task["node"]))
        if progress and progress.stage==3: goals.append({"id":key,"title":task["title"]})
    reports=[]
    for start in starts[-10:]:
        answer=submitted.get(start["attempt_id"])
        if not answer: continue
        reviews=[{k:e[k] for k in ("created_at","review")} for e in events if e["action"]=="self_review" and e["attempt_id"]==start["attempt_id"]]
        reports.append({"id":start["attempt_id"],"goal":start["goal"],"title":start["task"]["title"],
            "prompt":start["task"]["prompt"],"options":start["task"]["options"],"choice":answer["choice"],
            "explanation":answer["explanation"],"used_help":answer["used_help"],"choice_matches":answer["choice_matches"],
            "independence":answer["independence"],"status":"pending_review","created_at":answer["created_at"],
            "task_version":start["version"],"release_id":start["release_id"],"graph_revision":start["graph_revision"],
            "rubric":start["task"]["criteria"],"rationale":start["task"]["rationale"],"self_reviews":reviews,
            "review_state":projection(session.get(ReviewCase,start["attempt_id"]),answer["choice_matches"])})
    return {"revision":row.revision if row else 0,"version":VERSION,"goals":goals,"mastery":"unverified",
        "active": {"id":active["attempt_id"],"goal":active["goal"],"title":active["task"]["title"],"prompt":active["task"]["prompt"],"options":active["task"]["options"],"repeat_family":active["repeat_family"],"version":active["version"]} if active else None,
        "reports":reports}


@router.get("")
def current(request:Request):
    with request.app.state.sessions() as session:
        return state(session,session.get(VerificationSession,DEMO_GRAPH))


@router.post("/actions")
def act(body:Action,request:Request):
    digest=hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    with request.app.state.sessions() as session,session.begin():
        session.execute(insert(VerificationSession).values(id=DEMO_GRAPH,revision=0,events=[]).on_conflict_do_nothing())
        row=session.scalar(select(VerificationSession).where(VerificationSession.id==DEMO_GRAPH).with_for_update())
        for e in row.events:
            if e["key"]==body.operation_key:
                if e["hash"]!=digest: raise HTTPException(409,"操作键对应的内容已改变。")
                return e["result"]
        if row.revision!=body.base_revision: raise HTTPException(409,"验证记录已在另一处更新，请先读取最新记录。")
        if len(row.events)>=1000: raise HTTPException(409,"本地记录达到上限，需保留历史后扩容。")
        current=state(session,row)
        event={"key":body.operation_key,"hash":digest,"action":body.action,"created_at":now().isoformat()}
        if body.action=="start":
            if current["active"]: raise HTTPException(409,"先完成当前情境，不覆盖未完成作答。")
            if body.goal not in {g["id"] for g in current["goals"]}: raise HTTPException(409,"先完成对应知识的探索，再开始这个验证。")
            task=TASKS[body.goal]
            repeat=any(e["action"]=="start" and e["task"]["family"]==task["family"] for e in row.events)
            event.update(attempt_id=str(uuid4()),goal=body.goal,task=task,version=VERSION,
                repeat_family=repeat,release_id=request.app.state.release_id,
                graph_revision=session.get(LearnerGraph,DEMO_GRAPH).revision)
        else:
            start=next((e for e in row.events if e["action"]=="start" and e["attempt_id"]==body.attempt_id),None)
            if not start: raise HTTPException(404,"未找到对应作答。")
            event["attempt_id"]=body.attempt_id
            if body.action=="submit":
                if not current["active"] or current["active"]["id"]!=body.attempt_id: raise HTTPException(409,"此作答已提交，原文保留；重做请另开一次。")
                if not body.explanation.strip(): raise HTTPException(422,"请留下自己的解释；不确定时也可以写明卡在哪里。")
                event.update(choice=body.choice,explanation=body.explanation,used_help=body.used_help,
                    choice_matches=None if body.choice is None else body.choice==start["task"]["correct"],
                    independence="supported" if body.used_help else "repeat_family" if start["repeat_family"] else "not_established")
            else:
                answer=next((e for e in row.events if e["action"]=="submit" and e["attempt_id"]==body.attempt_id),None)
                if not answer: raise HTTPException(409,"先提交自己的作答，再查看量规复盘。")
                criteria={c["id"] for c in start["task"]["criteria"]}
                if len(body.review)!=3 or {i.criterion for i in body.review}!=criteria: raise HTTPException(422,"请逐项复盘全部三条量规，不重复或遗漏。")
                for item in body.review:
                    if not item.reason.strip(): raise HTTPException(422,"请说明这项判断的理由。")
                    if item.judgement in {"met","partial"} and (not item.quote.strip() or item.quote not in answer["explanation"]):
                        raise HTTPException(422,"满足或部分满足需引用作答原文中的实际片段。")
                event["review"]=[i.model_dump() for i in body.review]
        row.revision+=1
        row.events=[*row.events,event]
        result=state(session,row)
        row.events=[*row.events[:-1],{**event,"result":result}]
        return result
