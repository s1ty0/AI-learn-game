import copy
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta
from uuid import uuid4

import pytest
from app import candidates
from app.models import AdventureSession,VerificationSession
from test_learning_loop import client
from test_candidates import approve
from test_reviewing import actor
from test_verification import act


def save(client,payload):
    current=client.get("/api/v1/learner-graph").json()
    return client.post("/api/v1/learner-graph/operations",json={"base_revision":current["revision"],"operation_key":str(uuid4()),"payload":payload,"note":"测试关系原文"}).json()


def prepare(client,template="lookup-map"):
    source,target,node=("entity-0144","entity-0073","embedding") if template=="lookup-map" else ("entity-0138","entity-0014","loss")
    with client.app.state.sessions() as session,session.begin():
        for n in [node,"token"]:session.get(AdventureSession,"local-demo:"+n).stage=3
    graph=client.get("/api/v1/learner-graph").json();payload=graph["payload"]
    for entity in [source,target]:
        if not any(n["id"]==entity for n in payload["nodes"]):payload["nodes"].append({"id":entity,"type":"knowledge","position":{"x":0,"y":0},"data":{"label":entity,"note":"保留我的节点解释"}})
    payload["edges"].append({"id":"my-relation","source":source,"target":target,"label":"我的原关系，尚需检查","note":"固定条件后再判断，不能直接推广。"})
    return save(client,payload)


def start_bound(client,graph,template="lookup-map"):
    state=client.get("/api/v1/verification").json()
    return act(client,state,"start_relation",edge_id="my-relation",graph_revision=graph["revision"],relation_template=template)


def answer(client,state):
    response=act(client,state,"submit",attempt_id=state["active"]["id"],choice=1,explanation="固定编号映射后按顺序查表。原命题还需说明同步调整和适用边界，不能推广全部情况。")
    assert response.status_code==200
    return response.json()["reports"][-1]


def test_unsupported_reverse_and_undiscovered_relations_cannot_bind(client):
    graph=prepare(client)
    assert start_bound(client,graph,"invented").status_code==422
    payload=graph["payload"];edge=payload["edges"][-1];edge["source"],edge["target"]=edge["target"],edge["source"]
    graph=save(client,payload)
    assert client.get("/api/v1/relation-evidence/my-relation").json()["templates"]==[]
    assert start_bound(client,graph).status_code==422
    with client.app.state.sessions() as session,session.begin():session.get(AdventureSession,"local-demo:embedding").stage=0
    assert client.get("/api/v1/relation-evidence/my-relation").status_code==404


def test_missing_conditions_and_stale_graph_rejected(client):
    graph=prepare(client);stale=copy.deepcopy(graph)
    graph["payload"]["edges"][-1]["note"]=" "
    latest=save(client,graph["payload"])
    assert start_bound(client,stale).status_code==409
    assert start_bound(client,latest).status_code==422


@pytest.mark.parametrize("template",["lookup-map","mse-example"])
def test_binding_pins_exact_edge_and_requires_review_of_personal_claim(client,template):
    graph=prepare(client,template);state=start_bound(client,graph,template).json()
    assert "我的原关系，尚需检查" in state["active"]["prompt"] and "可能存在误解" in state["active"]["prompt"]
    assert "rubric" not in state["active"]
    report=answer(client,state)
    assert report["binding"]["edge"]["label"]=="我的原关系，尚需检查"
    assert report["binding"]["graph_revision"]==graph["revision"]
    assert "原命题" in report["rubric"][0]["requirement"] and report["status"]=="pending_review"
    assert client.get("/api/v1/learner-graph").json()==graph


def test_relation_attempt_does_not_fill_node_candidate_counts(client):
    graph=prepare(client);answer(client,start_bound(client,graph).json())
    for entity in ["entity-0144","entity-0073"]:
        assert client.get("/api/v1/star-evidence/"+entity).json()["items"]==[]
    assert client.get("/api/v1/relation-evidence/my-relation").json()["items"][0]["status"]=="needs_evidence"


def test_changed_claim_expires_relation_projection_and_preserves_original(client):
    graph=prepare(client);report=answer(client,start_bound(client,graph).json())
    graph["payload"]["edges"][-1]["label"]="后来改写的新命题"
    later=save(client,graph["payload"])
    projection=client.get("/api/v1/relation-evidence/my-relation").json()
    assert projection["items"][0]["status"]=="relation_changed" and not projection["items"][0]["matches_current"]
    assert projection["items"][0]["binding"]["edge"]["label"]=="我的原关系，尚需检查"
    assert client.get("/api/v1/verification/attempts/"+report["id"]).json()["binding"]==report["binding"]


def test_layout_and_node_notes_do_not_change_relation_semantics(client):
    graph=prepare(client);answer(client,start_bound(client,graph).json())
    graph["payload"]["nodes"][0]["position"]["x"]=250
    graph["payload"]["nodes"][0]["data"]["note"]="另一条节点笔记"
    save(client,graph["payload"])
    assert client.get("/api/v1/relation-evidence/my-relation").json()["items"][0]["matches_current"] is True


def test_removed_relation_keeps_old_evidence_and_restore_rechecks_original(client):
    graph=prepare(client);report=answer(client,start_bound(client,graph).json())
    payload=copy.deepcopy(graph["payload"]);payload["edges"]=[e for e in payload["edges"] if e["id"]!="my-relation"]
    removed=save(client,payload)
    assert client.get("/api/v1/relation-evidence/my-relation").status_code==404
    assert client.get("/api/v1/candidates?source_id="+report["id"]).json()["items"][0]["status"]=="relation_changed"
    restored=client.post("/api/v1/learner-graph/restore",json={"base_revision":removed["revision"],"operation_key":str(uuid4()),"revision":graph["revision"]})
    assert restored.status_code==200
    assert client.get("/api/v1/relation-evidence/my-relation").json()["items"][0]["matches_current"] is True


def test_bound_recheck_requires_unchanged_claim_and_its_own_review(client,monkeypatch):
    graph=prepare(client);report=answer(client,start_bound(client,graph).json());headers=[actor(client,"alice"),actor(client,"bob")];approve(client,report,headers)
    monkeypatch.setattr(candidates,"now",lambda:datetime.fromisoformat(report["created_at"])+timedelta(hours=72))
    item=client.get("/api/v1/candidates?source_id="+report["id"]).json()["items"][0]
    state=client.get("/api/v1/verification").json()
    result=act(client,state,"start_recheck",parent_attempt=report["id"],parent_review_revision=item["initial"]["review_revision"])
    assert result.status_code==200 and "我的原关系" in result.json()["active"]["prompt"]
    child=answer(client,result.json());assert child["binding"]["edge"]==report["binding"]["edge"]
    assert client.get("/api/v1/relation-evidence/my-relation").json()["items"][0]["status"]=="recheck_needs_evidence"


def test_first_concurrent_binding_and_retry_are_safe(client):
    graph=prepare(client)
    with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:start_bound(client,graph),range(2)))
    assert sorted(r.status_code for r in results)==[200,409]
    winner=next(r for r in results if r.status_code==200)
    assert client.post("/api/v1/verification/actions",json=json.loads(winner.request.content)).json()==winner.json()


def test_new_claim_keeps_repeat_family_exposure_instead_of_resetting_independence(client):
    graph=prepare(client);answer(client,start_bound(client,graph).json())
    graph["payload"]["edges"][-1]["note"]="固定条件，后来补充的说明。"
    latest=save(client,graph["payload"])
    response=start_bound(client,latest)
    assert response.status_code==200 and response.json()["active"]["repeat_family"] is True


def test_relation_history_pagination_and_binding_input_scope(client):
    graph=prepare(client)
    state=client.get("/api/v1/verification").json()
    assert act(client,state,"start",goal="lookup",edge_id="my-relation",graph_revision=graph["revision"],relation_template="lookup-map").status_code==422
    report=answer(client,start_bound(client,graph).json())
    with client.app.state.sessions() as session,session.begin():
        row=session.get(VerificationSession,"local-demo");events=list(row.events);first=events[0];answer_event=events[1]
        for _ in range(31):
            identity=str(uuid4())
            events.extend([{**{k:v for k,v in first.items() if k!="result"},"attempt_id":identity,"key":str(uuid4()),"repeat_family":True},
                           {**{k:v for k,v in answer_event.items() if k!="result"},"attempt_id":identity,"key":str(uuid4())}])
        row.events=events;row.revision=len(events)
    recent=client.get("/api/v1/relation-evidence/my-relation").json()
    assert recent["total"]==32 and recent["next_offset"]==30 and len(recent["items"])==30
    assert all(i["id"]!=report["id"] for i in recent["items"])
    older=client.get("/api/v1/relation-evidence/my-relation?offset=30").json()
    assert any(i["id"]==report["id"] for i in older["items"])
    assert client.get("/api/v1/relation-evidence/my-relation?offset=-1").status_code==422
