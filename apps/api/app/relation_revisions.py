"""Explicit learner repair tasks. A saved revision is not verified mastery."""
import hashlib
import json
from uuid import uuid4

from fastapi import APIRouter,Request,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .content import DEMO_GRAPH
from .models import VerificationSession,ReviewCase,GraphSnapshot,GraphOperation,now
from .relation_evidence import current_edge
from .relation_tasks import signature
from .reviewing import projection
from .schemas import GraphPayload
from . import revision_challenges

router=APIRouter(prefix="/api/v1/relation-revisions")


def source_pair(row,attempt_id):
    events=row.events if row else []
    start=next((e for e in events if e["action"]=="start" and e["attempt_id"]==attempt_id and e.get("binding")),None)
    answer=next((e for e in events if e["action"]=="submit" and e["attempt_id"]==attempt_id),None)
    if not start or not answer:raise HTTPException(404,"未找到已提交的关系绑定作答，不能从未提交题生成修订任务。")
    return start,answer


def task_data(session,row,attempt_id):
    start,answer=source_pair(row,attempt_id)
    binding=start["binding"]
    head,snapshot,edge=current_edge(session,binding["edge"]["id"])
    if (edge["source"],edge["target"])!=(binding["edge"]["source"],binding["edge"]["target"]):raise HTTPException(409,"当前连线端点或方向已改变，请先回星图核对，不把旧关系任务套到新方向。")
    summary=projection(session.get(ReviewCase,attempt_id),answer["choice_matches"])
    latest={e["actor"]:e for e in summary["history"]}
    criteria=[]
    for c in start["task"]["criteria"]:
        opinions=[{"reviewer":e["actor_name"],"review_id":e["id"],**i} for e in latest.values() for i in e["items"] if i["criterion"]==c["id"]]
        criteria.append({**c,"gap":not opinions or any(i["judgement"]!="met" for i in opinions),"disputed":c["id"] in summary["disagreements"],"opinions":opinions})
    history=[{k:e[k] for k in ("id","created_at","source_attempt","graph_before","graph_after","before","after","criteria","reason","counterexample","review_revision","source_reviews")} for e in row.events if e["action"]=="relation_revision" and e["source_attempt"]==attempt_id]
    answers={e["attempt_id"]:e for e in row.events if e["action"]=="submit"}
    for entry in history:
        entry["challenges"]=[{"id":e["attempt_id"],"focus":e["revision_origin"]["focus"],"title":e["task"]["title"],"submitted":e["attempt_id"] in answers,
                              "choice_matches":answers.get(e["attempt_id"],{}).get("choice_matches"),"explanation_status":"pending_review"}
                             for e in row.events if e["action"]=="start" and e.get("revision_origin",{}).get("revision_id")==entry["id"]]
    return {"source_attempt":attempt_id,"title":"修订："+start["task"]["title"],"verification_revision":row.revision,"graph_revision":head.revision,"review_revision":summary["revision"],
            "binding":binding,"current":signature(edge),"answer":answer["explanation"],"prediction_matches":answer["choice_matches"],"criteria":criteria,
            "history":history,"mastery":"unverified","note":"复核意见是定位线索，不自动改写你的命题。保存后仍需验证新关系。"}


class Submit(BaseModel):
    model_config=ConfigDict(extra="forbid")
    operation_key:str=Field(min_length=8,max_length=120)
    graph_revision:int=Field(ge=0)
    review_revision:int=Field(ge=0)
    verification_revision:int=Field(ge=0)
    label:str=Field(min_length=1,max_length=200)
    note:str=Field(min_length=1,max_length=3000)
    criteria:list[str]=Field(min_length=1,max_length=3)
    reason:str=Field(min_length=1,max_length=2000)
    counterexample:str=Field(min_length=1,max_length=2000)


@router.get("/challenge/{revision_id}")
def challenge(revision_id:str,request:Request):
    with request.app.state.sessions() as session:
        row=session.get(VerificationSession,DEMO_GRAPH)
        repair,binding=revision_challenges.context(session,row,revision_id,request.app.state.release_id)
        return {"revision_id":repair["id"],"source_attempt":repair["source_attempt"],"graph_revision":binding["graph_revision"],"edge":binding["edge"],
                "focuses":[{"id":focus,"title":revision_challenges.FOCI[focus]} for focus in repair["criteria"] if focus in revision_challenges.FOCI],
                "mastery":"unverified","note":"一次只检查一个缺口；提交前隐藏参考与量规。挑战是修订练习，不计入候选或跳级。"}


@router.get("/{attempt_id}")
def read(attempt_id:str,request:Request):
    with request.app.state.sessions() as session:return task_data(session,session.get(VerificationSession,DEMO_GRAPH),attempt_id)


@router.post("/{attempt_id}")
def save_revision(attempt_id:str,body:Submit,request:Request):
    digest=hashlib.sha256(json.dumps({"source_attempt":attempt_id,**body.model_dump()},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    with request.app.state.sessions() as session,session.begin():
        row=session.scalar(select(VerificationSession).where(VerificationSession.id==DEMO_GRAPH).with_for_update())
        if not row:raise HTTPException(404,"没有关系作答记录。")
        for e in row.events:
            if e["key"]==body.operation_key:
                if e["hash"]!=digest or e["action"]!="relation_revision":raise HTTPException(409,"操作键已用于其他内容，请勿复用。")
                return e["result"]
        start,answer=source_pair(row,attempt_id)
        if row.revision!=body.verification_revision:raise HTTPException(409,"验证或修订记录已变化，请先对照最新任务，草稿仍保留。")
        if len(row.events)>=1000:raise HTTPException(409,"记录达到本地上限，需保留历史后扩容。")
        session.execute(insert(ReviewCase).values(attempt_id=attempt_id,revision=0,events=[]).on_conflict_do_nothing())
        case=session.scalar(select(ReviewCase).where(ReviewCase.attempt_id==attempt_id).with_for_update().execution_options(populate_existing=True))
        if (case.revision if case else 0)!=body.review_revision:raise HTTPException(409,"复核意见已更新，请先对照最新依据。")
        head,snapshot,edge=current_edge(session,start["binding"]["edge"]["id"],lock=True)
        if head.revision!=body.graph_revision:raise HTTPException(409,"星图已在另一处更新，请先对照当前命题，不能覆盖。")
        if (edge["source"],edge["target"])!=(start["binding"]["edge"]["source"],start["binding"]["edge"]["target"]):raise HTTPException(409,"当前关系方向/端点已改变，请先回星图核对。")
        allowed={c["id"] for c in start["task"]["criteria"]}
        if len(set(body.criteria))!=len(body.criteria) or not set(body.criteria)<=allowed:raise HTTPException(422,"修订条目不可重复或伪造。")
        if not all(value.strip() for value in (body.label,body.note,body.reason,body.counterexample)):raise HTTPException(422,"请写清新命题、条件、修订理由和反例，不能只填空白。")
        if body.label==edge["label"] and body.note==edge.get("note",""):raise HTTPException(422,"当前命题和条件尚未变化；需要澄清时请写入明确条件，不虚构已修订。")
        if session.scalar(select(GraphOperation).where(GraphOperation.graph_id==DEMO_GRAPH,GraphOperation.operation_key=="relation-revision:"+body.operation_key)):raise HTTPException(409,"此图操作键已经使用，请先读取最新记录。")
        before=signature(edge)
        payload={**snapshot.payload,"edges":[{**item,"label":body.label,"note":body.note} if item["id"]==edge["id"] else item for item in snapshot.payload["edges"]]}
        GraphPayload.model_validate(payload)
        graph_before=head.revision;head.revision+=1
        session.add(GraphSnapshot(graph_id=DEMO_GRAPH,revision=head.revision,release_id=snapshot.release_id,payload=payload,note="关系修订任务："+body.reason[:100],restored_from=None))
        session.add(GraphOperation(id=str(uuid4()),graph_id=DEMO_GRAPH,operation_key="relation-revision:"+body.operation_key,base_revision=graph_before,result_revision=head.revision,request_hash=digest))
        summary=projection(case,answer["choice_matches"])
        latest={e["actor"]:e for e in summary["history"]}
        event={"action":"relation_revision","id":str(uuid4()),"key":body.operation_key,"hash":digest,"created_at":now().isoformat(),"source_attempt":attempt_id,
               "graph_before":graph_before,"graph_after":head.revision,"before":before,"after":{**before,"label":body.label,"note":body.note},
               "criteria":body.criteria,"reason":body.reason,"counterexample":body.counterexample,"review_revision":body.review_revision,
               "source_reviews":list(latest.values()),"binding":start["binding"]}
        row.revision+=1
        result={"id":event["id"],"graph_revision":head.revision,"verification_revision":row.revision,"source_attempt":attempt_id,"status":"revised_not_verified","before":event["before"],"after":event["after"],"mastery":"unverified"}
        row.events=[*row.events,{**event,"result":result}]
        return result
