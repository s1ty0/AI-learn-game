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
from .recheck_content import RECHECK_TASKS
from .candidates import ledger,admission,POLICY
from .relation_evidence import binding_for,unchanged
from .relation_tasks import TEMPLATES,task_for
from . import revision_challenges

router = APIRouter(prefix="/api/v1/verification")
VERSION = "transfer-v1-" + hashlib.sha256(json.dumps(TASKS,ensure_ascii=False).encode()).hexdigest()[:12]
RECHECK_VERSION="recheck-v1-"+hashlib.sha256(json.dumps(RECHECK_TASKS,ensure_ascii=False).encode()).hexdigest()[:12]


class ReviewItem(BaseModel):
    criterion: Literal["path","conditions","boundary"]
    judgement: Literal["met","partial","missing","unsure"]
    quote: str = Field(default="",max_length=1000)
    reason: str = Field(min_length=1,max_length=1000)


class Action(BaseModel):
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8,max_length=120)
    action: Literal["start","start_relation","start_recheck","start_revision_challenge","submit","self_review"]
    goal: str | None = Field(default=None,max_length=50)
    attempt_id: str | None = Field(default=None,max_length=100)
    choice: int | None = Field(default=None,ge=0,le=2)
    explanation: str = Field(default="",max_length=5000)
    used_help: bool = False
    review: list[ReviewItem] = Field(default_factory=list,max_length=3)
    parent_attempt: str | None = Field(default=None,max_length=100)
    parent_review_revision: int | None = Field(default=None,ge=0)
    edge_id: str | None = Field(default=None,min_length=1,max_length=120)
    graph_revision: int | None = Field(default=None,ge=0)
    relation_template: str | None = Field(default=None,max_length=100)
    revision_id: str | None = Field(default=None,min_length=1,max_length=100)
    revision_focus: Literal["path","conditions","boundary"] | None = None


def state(session,row=None,report_id=None):
    events=row.events if row else []
    submitted={e["attempt_id"]:e for e in events if e["action"]=="submit"}
    starts=[e for e in events if e["action"]=="start"]
    active=next((e for e in reversed(starts) if e["attempt_id"] not in submitted),None)
    goals=[]
    for key,task in TASKS.items():
        progress=session.get(AdventureSession,session_id(task["node"]))
        if progress and progress.stage==3: goals.append({"id":key,"title":task["title"]})
    reports=[]
    for start in ([s for s in starts if s["attempt_id"]==report_id] if report_id else starts[-10:]):
        answer=submitted.get(start["attempt_id"])
        if not answer: continue
        reviews=[{k:e[k] for k in ("created_at","review")} for e in events if e["action"]=="self_review" and e["attempt_id"]==start["attempt_id"]]
        reports.append({"id":start["attempt_id"],"goal":start["goal"],"title":start["task"]["title"],
            "prompt":start["task"]["prompt"],"options":start["task"]["options"],"choice":answer["choice"],
            "explanation":answer["explanation"],"used_help":answer["used_help"],"choice_matches":answer["choice_matches"],
            "independence":answer["independence"],"status":"pending_review","created_at":answer["created_at"],
            "task_version":start["version"],"release_id":start["release_id"],"graph_revision":start["graph_revision"],
            "rubric":start["task"]["criteria"],"rationale":start["task"]["rationale"],"self_reviews":reviews,
            "review_state":projection(session.get(ReviewCase,start["attempt_id"]),answer["choice_matches"]),
            "kind":start.get("kind","transfer"),"parent_attempt":start.get("parent_attempt"),"evidence_policy":start.get("evidence_policy"),**({"binding":start["binding"]} if start.get("binding") else {}),**revision_challenges.feedback(start,answer)})
    return {"revision":row.revision if row else 0,"version":VERSION,"goals":goals,"mastery":"unverified",
        "active": {"id":active["attempt_id"],"goal":active["goal"],"title":active["task"]["title"],"prompt":active["task"]["prompt"],"options":active["task"]["options"],"repeat_family":active["repeat_family"],"version":active["version"],"kind":active.get("kind","transfer"),"parent_attempt":active.get("parent_attempt"),**({"revision_origin":active["revision_origin"]} if active.get("revision_origin") else {})} if active else None,
        "reports":reports}


@router.get("")
def current(request:Request):
    with request.app.state.sessions() as session:
        return state(session,session.get(VerificationSession,DEMO_GRAPH))


@router.get("/attempts/{attempt_id}")
def historical_attempt(attempt_id:str,request:Request):
    with request.app.state.sessions() as session:
        result=state(session,session.get(VerificationSession,DEMO_GRAPH),report_id=attempt_id)
        if not result["reports"]:raise HTTPException(404,"未找到已提交作答，未提交题的答案和量规仍隐藏。")
        return result["reports"][0]


@router.post("/actions")
def act(body:Action,request:Request):
    new_fields={"edge_id","graph_revision","relation_template"}
    challenge_fields={"revision_id","revision_focus"}
    has_challenge_input=any(getattr(body,k) is not None for k in challenge_fields)
    has_binding_input=any(getattr(body,k) is not None for k in new_fields)
    excluded=(set() if has_binding_input else new_fields)|(set() if has_challenge_input else challenge_fields)
    digest=hashlib.sha256(body.model_dump_json(exclude=excluded).encode()).hexdigest()
    legacy_digest=hashlib.sha256(body.model_dump_json(exclude=new_fields|challenge_fields|{"parent_attempt","parent_review_revision"}).encode()).hexdigest()
    with request.app.state.sessions() as session,session.begin():
        session.execute(insert(VerificationSession).values(id=DEMO_GRAPH,revision=0,events=[]).on_conflict_do_nothing())
        row=session.scalar(select(VerificationSession).where(VerificationSession.id==DEMO_GRAPH).with_for_update())
        for e in row.events:
            if e["key"]==body.operation_key:
                legacy_match=not has_binding_input and not has_challenge_input and body.parent_attempt is None and body.parent_review_revision is None and e["hash"]==legacy_digest
                if e["hash"]!=digest and not legacy_match: raise HTTPException(409,"操作键对应的内容已改变。")
                return e["result"]
        if row.revision!=body.base_revision: raise HTTPException(409,"验证记录已在另一处更新，请先读取最新记录。")
        if len(row.events)>=1000: raise HTTPException(409,"本地记录达到上限，需保留历史后扩容。")
        if has_binding_input and body.action not in {"start_relation","start_revision_challenge"}:raise HTTPException(422,"关系绑定字段只能用于明确开始关系验证。")
        if has_challenge_input and body.action!="start_revision_challenge":raise HTTPException(422,"修订来源只能用于明确开始修订挑战。")
        if body.action=="start_relation" and (body.parent_attempt is not None or body.parent_review_revision is not None):raise HTTPException(422,"首次关系验证不能伪造复验来源。")
        current=state(session,row)
        event={"key":body.operation_key,"hash":digest,"action":body.action,"created_at":now().isoformat()}
        if body.action in {"start","start_relation","start_recheck","start_revision_challenge"}:
            if current["active"]: raise HTTPException(409,"先完成当前情境，不覆盖未完成作答。")
            if body.action=="start_revision_challenge":
                if body.revision_id is None or body.revision_focus is None or body.graph_revision is None:raise HTTPException(422,"请选择已保存修订、一个目标和当前图版本。")
                if any(v is not None for v in (body.edge_id,body.relation_template,body.parent_attempt,body.parent_review_revision,body.goal)):raise HTTPException(422,"修订挑战的关系与目标由服务端读取，不接受伪造来源。")
                repair,binding=revision_challenges.context(session,row,body.revision_id,request.app.state.release_id,body.graph_revision,lock=True)
                goal=TEMPLATES[binding["template"]]["goal"]
                if goal not in {g["id"] for g in current["goals"]}:raise HTTPException(409,"先完成对应探索，修订练习不绕过前置。")
                task=revision_challenges.task_for(repair,binding,body.revision_focus)
                event.update(binding=binding,revision_origin={"revision_id":repair["id"],"source_attempt":repair["source_attempt"],"focus":body.revision_focus,"graph_revision":repair["graph_after"]})
            elif body.action=="start_recheck":
                source=next((s for s in row.events if s["action"]=="start" and s["attempt_id"]==body.parent_attempt and s.get("kind") not in {"recheck","revision_challenge"}),None)
                if not source:raise HTTPException(404,"未找到初次验证来源。")
                parent_case=session.scalar(select(ReviewCase).where(ReviewCase.attempt_id==body.parent_attempt).with_for_update().execution_options(populate_existing=True))
                if not parent_case or parent_case.revision!=body.parent_review_revision:raise HTTPException(409,"来源复核已变化，请刷新候选证据。")
                snapshot=ledger(session,source_id=body.parent_attempt)
                candidate=next((c for c in snapshot["items"] if c["id"]==body.parent_attempt),None)
                if not candidate or candidate["status"]!="ready_for_recheck":raise HTTPException(409,"初次证据、72小时间隔或当前复验状态尚不满足，不能提前开始。")
                if source.get("binding"):
                    # Keep graph lock order consistent with initial bound attempts.
                    binding=binding_for(session,request.app.state.release_id,source["binding"]["edge"]["id"],session.get(LearnerGraph,DEMO_GRAPH).revision,source["binding"]["template"],lock=True)
                    if binding["edge"]!=source["binding"]["edge"]:raise HTTPException(409,"关系已改变，旧来源不能作为当前关系复验。")
                    event["binding"]=binding
                    task=task_for(binding["template"],binding,recheck=True)
                else:task=RECHECK_TASKS[source["goal"]]
                event.update(parent_attempt=source["attempt_id"],parent_review_revision=parent_case.revision,evidence_policy=POLICY,due_at=candidate["due_at"],created_at=snapshot["server_time"])
                goal=source["goal"]
            elif body.action=="start_relation":
                if body.edge_id is None or body.graph_revision is None or body.relation_template is None:raise HTTPException(422,"请选择保存后的关系与明确验证目标。")
                binding=binding_for(session,request.app.state.release_id,body.edge_id,body.graph_revision,body.relation_template,lock=True)
                goal=TEMPLATES[body.relation_template]["goal"]
                if goal not in {g["id"] for g in current["goals"]}:raise HTTPException(409,"对应探索尚未完成，关系验证不绕过前置。")
                task=task_for(body.relation_template,binding)
                event["binding"]=binding
            else:
                if body.parent_attempt is not None or body.parent_review_revision is not None:raise HTTPException(422,"普通验证不能伪造复验来源。")
                if body.goal not in {g["id"] for g in current["goals"]}: raise HTTPException(409,"先完成对应知识的探索，再开始这个验证。")
                task=TASKS[body.goal];goal=body.goal
            repeat=any(e["action"]=="start" and e["task"]["family"]==task["family"] for e in row.events)
            bound_version="relation-v1-"+hashlib.sha256(json.dumps(task,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:12] if event.get("binding") else None
            event.update(action="start",kind="revision_challenge" if body.action=="start_revision_challenge" else "recheck" if body.action=="start_recheck" else "transfer",attempt_id=str(uuid4()),goal=goal,task=task,version=bound_version or (RECHECK_VERSION if body.action=="start_recheck" else VERSION),
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
