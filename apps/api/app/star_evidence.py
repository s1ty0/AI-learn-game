"""Current evidence is a read-only overlay, never saved into historical graphs."""
from fastapi import APIRouter,Request,HTTPException

from .candidates import ledger
from .discoveries import discovery_state
from .guidance_content import PACKS
from .verification_content import TASKS

router=APIRouter(prefix="/api/v1/star-evidence")
MAPPING={"entity-0068":["mask"],"entity-0147":["weights"],"entity-0073":["lookup"],"entity-0144":["lookup"],"entity-0014":["loss"]}
BRIDGE={"mask":"mask","weights":"weights","lookup":"token","loss":"loss"}


def context(session,release_id):
    found=discovery_state(session,release_id)
    ids={entity["id"] for entity in found["entities"]}
    completed={origin["node_id"] for entity in found["entities"] for origin in entity["origins"]}
    return ids,completed


@router.get("")
def summary(request:Request):
    with request.app.state.sessions() as session:
        ids,completed=context(session,request.app.state.release_id)
        all_items=ledger(session,page_size=None)["items"]
        return {"scope":"current_evidence","mastery":"unverified","entities":[
            {"id":entity,"covered":entity in MAPPING,
             "counts":{status:sum(item["status"]==status for item in all_items if item["goal"] in MAPPING.get(entity,[]))
                       for status in sorted({item["status"] for item in all_items if item["goal"] in MAPPING.get(entity,[])})}}
            for entity in sorted(ids)]}


@router.get("/{entity_id}")
def details(entity_id:str,request:Request,offset:int=0):
    if not 0<=offset<=10000:raise HTTPException(422,"证据分页位置超出范围。")
    with request.app.state.sessions() as session:
        ids,completed=context(session,request.app.state.release_id)
        if entity_id not in ids:raise HTTPException(404,"该知识尚未发现，不能通过证据入口提前展开。")
        goals=MAPPING.get(entity_id,[])
        evidence=ledger(session,offset=offset,goals=goals)
        return {"entity_id":entity_id,"scope":"current_evidence","mastery":"unverified",**evidence,
                "goals":[{"id":goal,"title":TASKS[goal]["title"],"available":TASKS[goal]["node"] in completed,
                          "bridge":PACKS[BRIDGE[goal]]["bridge"]} for goal in goals]}
