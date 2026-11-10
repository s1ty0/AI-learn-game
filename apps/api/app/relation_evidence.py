from .learner_context import learner_id
from fastapi import APIRouter,Request,HTTPException
from sqlalchemy import select

from .models import LearnerGraph,GraphSnapshot,VerificationSession
from .discoveries import discovery_state
from .candidates import ledger
from .relation_tasks import TEMPLATES,signature

router=APIRouter(prefix="/api/v1/relation-evidence")


def current_edge(session,edge_id,lock=False):
    query=select(LearnerGraph).where(LearnerGraph.id==learner_id(session))
    if lock:query=query.with_for_update().execution_options(populate_existing=True)
    head=session.scalar(query)
    snapshot=session.get(GraphSnapshot,(learner_id(session),head.revision))
    edge=next((e for e in snapshot.payload["edges"] if e["id"]==edge_id),None)
    if not edge:raise HTTPException(404,"当前图中未找到这条连线，旧作答仍可在验证室回看。")
    return head,snapshot,edge


def binding_for(session,release_id,edge_id,revision,template,lock=False):
    head,snapshot,edge=current_edge(session,edge_id,lock)
    if head.revision!=revision:raise HTTPException(409,"星图版本已变化，请先保存并读取最新关系。")
    definition=TEMPLATES.get(template)
    if not definition or edge["source"]!=definition["source"] or edge["target"]!=definition["target"]:raise HTTPException(422,"验证目标与这条关系的方向/知识ID不匹配。")
    if not str(edge.get("label","")).strip() or not str(edge.get("note","")).strip():raise HTTPException(422,"先在星图写出关系命题、理由和条件，再保存后验证。")
    found=discovery_state(session,release_id)
    if not {edge["source"],edge["target"]}<={e["id"] for e in found["entities"]}:raise HTTPException(409,"先完成两个端点对应的探索。")
    return {"template":template,"graph_revision":head.revision,"graph_release":snapshot.release_id,"edge":signature(edge)}


def unchanged(session,binding):
    try:_,_,edge=current_edge(session,binding["edge"]["id"])
    except HTTPException:return False
    return signature(edge)==binding["edge"]


@router.get("/{edge_id}")
def detail(edge_id:str,request:Request,offset:int=0):
    if not 0<=offset<=10000:raise HTTPException(422,"关系证据分页位置超出范围。")
    with request.app.state.sessions() as session:
        head,snapshot,edge=current_edge(session,edge_id)
        found=discovery_state(session,request.app.state.release_id)
        if not {edge["source"],edge["target"]}<={e["id"] for e in found["entities"]}:raise HTTPException(404,"这条连线端点尚未发现，不能提前展开关系验证。")
        templates=[{"id":key,"title":value["title"]} for key,value in TEMPLATES.items() if value["source"]==edge["source"] and value["target"]==edge["target"]]
        row=session.get(VerificationSession,learner_id(session))
        starts=[e for e in row.events if e["action"]=="start" and e.get("binding") and e["binding"]["edge"]["id"]==edge_id and e.get("kind")!="recheck"] if row else []
        result=ledger(session,edge_id=edge_id,offset=offset,page_size=30)
        bindings={e["attempt_id"]:e["binding"] for e in starts}
        return {"edge":signature(edge),"graph_revision":head.revision,"templates":templates,"items":[{**item,"binding":bindings[item["id"]],"matches_current":unchanged(session,bindings[item["id"]])} for item in result["items"]],"next_offset":result["next_offset"],"total":result["total"],"mastery":"unverified"}
