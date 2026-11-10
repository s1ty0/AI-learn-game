import hashlib
import json
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .learner_context import learner_id
from .models import ReviewActor, ReviewCase, VerificationSession, now

router=APIRouter(prefix="/api/v1/reviewing")
bearer=HTTPBearer(auto_error=False)
PUBLIC_FIELDS=("id","actor","actor_name","created_at","items","correction_reason","supersedes","task_version")


def authenticate(request:Request,credentials:HTTPAuthorizationCredentials|None=Depends(bearer)):
    if not credentials or credentials.scheme.lower()!="bearer":raise HTTPException(401,"需要复核者访问钥匙。",headers={"WWW-Authenticate":"Bearer"})
    digest=hashlib.sha256(credentials.credentials.encode()).hexdigest()
    with request.app.state.sessions() as session:
        actor=session.scalar(select(ReviewActor).where(ReviewActor.token_hash==digest,ReviewActor.enabled==1))
        if not actor or (actor.id=="local-demo" or actor.learner_id!=learner_id(session)):raise HTTPException(401,"访问钥匙无效或已停用。")
        return {"id":actor.id,"name":actor.name}


def attempts(session):
    row=session.get(VerificationSession,learner_id(session))
    events=row.events if row else []
    starts={e["attempt_id"]:e for e in events if e["action"]=="start"}
    return [(starts[e["attempt_id"]],e) for e in events if e["action"]=="submit"]


def projection(case,choice_matches,upto=None):
    events=(case.events[:upto] if upto is not None else case.events) if case else []
    latest={e["actor"]:e for e in events}
    disagreements=[]
    for criterion in ("path","conditions","boundary"):
        votes={i["judgement"] for e in latest.values() for i in e["items"] if i["criterion"]==criterion}
        if len(votes)>1:disagreements.append(criterion)
    if not latest:status="pending_review"
    elif len(latest)==1:status="single_review"
    elif disagreements:status="disputed"
    elif choice_matches is not True or any(i["judgement"]!="met" for e in latest.values() for i in e["items"]):status="needs_followup"
    else:status="consistent_review"
    return {"revision":(upto if upto is not None else case.revision) if case else 0,"status":status,"reviewer_count":len(latest),"disagreements":disagreements,
            "history":[{**{k:e[k] for k in PUBLIC_FIELDS},"observation":e.get("observation",{"judgement":"not_established","basis":""})} for e in events],"mastery":"unverified"}


def detail(session,attempt_id,actor,upto=None):
    pair=next(((s,a) for s,a in attempts(session) if s["attempt_id"]==attempt_id),None)
    if not pair:raise HTTPException(404,"未找到已提交作答；未提交题不可复核。")
    start,answer=pair
    case=session.get(ReviewCase,attempt_id)
    summary=projection(case,answer["choice_matches"],upto)
    own=[e for e in summary["history"] if e["actor"]==actor["id"]]
    return {"id":attempt_id,"title":start["task"]["title"],"prompt":start["task"]["prompt"],"options":start["task"]["options"],
            "choice":answer["choice"],"choice_matches":answer["choice_matches"],"explanation":answer["explanation"],
            "independence":answer["independence"],"task_version":start["version"],"rubric":start["task"]["criteria"],"rationale":start["task"]["rationale"],
            "graph_revision":start["graph_revision"],"revision":summary["revision"],"own_latest":own[-1] if own else None,
            "review_state":summary if own else {**summary,"status":"awaiting_your_review","history":[],"disagreements":[]},
            "peers_hidden":not bool(own)}


class Item(BaseModel):
    model_config=ConfigDict(extra="forbid")
    criterion:Literal["path","conditions","boundary"]
    judgement:Literal["met","partial","missing","unsure"]
    quote:str=Field(default="",max_length=1000)
    reason:str=Field(min_length=1,max_length=1000)


class Observation(BaseModel):
    model_config=ConfigDict(extra="forbid")
    judgement:Literal["not_established","observed_no_help","assisted"]="not_established"
    basis:str=Field(default="",max_length=1500)


class Submit(BaseModel):
    model_config=ConfigDict(extra="forbid")
    base_revision:int=Field(ge=0)
    operation_key:str=Field(min_length=8,max_length=120)
    items:list[Item]=Field(min_length=3,max_length=3)
    supersedes:str|None=Field(default=None,max_length=100)
    correction_reason:str=Field(default="",max_length=1500)
    observation:Observation=Field(default_factory=Observation)


@router.get("/me")
def me(actor=Depends(authenticate)):return actor


@router.get("")
def queue(request:Request,offset:int=0,actor=Depends(authenticate)):
    if not 0<=offset<=10000:raise HTTPException(422,"队列位置超出范围。")
    with request.app.state.sessions() as session:
        pairs=list(reversed(attempts(session)))
        items=[]
        for start,answer in pairs[offset:offset+20]:
            summary=projection(session.get(ReviewCase,start["attempt_id"]),answer["choice_matches"])
            items.append({"id":start["attempt_id"],"title":start["task"]["title"],"created_at":answer["created_at"],"reviewer_count":summary["reviewer_count"],
                          "has_own_review":any(e["actor"]==actor["id"] for e in summary["history"])})
        return {"items":items,"total":len(pairs),"next_offset":offset+20 if offset+20<len(pairs) else None}


@router.get("/{attempt_id}")
def read(attempt_id:str,request:Request,actor=Depends(authenticate)):
    with request.app.state.sessions() as session:return detail(session,attempt_id,actor)


@router.post("/{attempt_id}")
def submit(attempt_id:str,body:Submit,request:Request,actor=Depends(authenticate)):
    digest=hashlib.sha256(json.dumps({"actor":actor["id"],**body.model_dump()},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    legacy_digest=hashlib.sha256(json.dumps({"actor":actor["id"],**body.model_dump(exclude={"observation"})},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    with request.app.state.sessions() as session,session.begin():
        current=detail(session,attempt_id,actor)
        session.execute(insert(ReviewCase).values(attempt_id=attempt_id,revision=0,events=[]).on_conflict_do_nothing())
        case=session.scalar(select(ReviewCase).where(ReviewCase.attempt_id==attempt_id).with_for_update().execution_options(populate_existing=True))
        for index,e in enumerate(case.events):
            if e["key"]==body.operation_key:
                legacy_match="observation" not in e and body.observation==Observation() and e["hash"]==legacy_digest
                if e["hash"]!=digest and not legacy_match:raise HTTPException(409,"操作键内容或复核者不一致。")
                return detail(session,attempt_id,actor,upto=index+1)
        if case.revision!=body.base_revision:raise HTTPException(409,"这份作答已有新复核，请保留草稿并读取最新记录。")
        if len(case.events)>=1000:raise HTTPException(409,"复核记录达到本地上限，需保留历史后扩容。")
        own=next((e for e in reversed(case.events) if e["actor"]==actor["id"]),None)
        if (own["id"] if own else None)!=body.supersedes:raise HTTPException(409,"只能追加纠正自己的最新复核。")
        if own and not body.correction_reason.strip():raise HTTPException(422,"追加纠正必须说明改变判断的原因。")
        if body.observation.judgement!="not_established" and not body.observation.basis.strip():raise HTTPException(422,"记录独立性观察时必须说明实际观察依据，不能只据自报或答案文字判断。")
        if {i.criterion for i in body.items}!={c["id"] for c in current["rubric"]}:raise HTTPException(422,"量规不可重复或遗漏。")
        for item in body.items:
            if not item.reason.strip():raise HTTPException(422,"每项需说明判断理由。")
            if (item.quote and item.quote not in current["explanation"]) or (item.judgement in {"met","partial"} and not item.quote.strip()):
                raise HTTPException(422,"满足/部分满足需引用真实作答；任何引用都不可伪造。")
        event={"id":str(uuid4()),"actor":actor["id"],"actor_name":actor["name"],"created_at":now().isoformat(),"items":[i.model_dump() for i in body.items],
               "supersedes":body.supersedes,"correction_reason":body.correction_reason,"task_version":current["task_version"],"observation":body.observation.model_dump(),"key":body.operation_key,"hash":digest}
        case.revision+=1;case.events=[*case.events,event]
        return detail(session,attempt_id,actor)
