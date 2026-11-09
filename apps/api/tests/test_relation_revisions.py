import copy
import json
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app.models import VerificationSession
from test_learning_loop import client
from test_relation_evidence import prepare,start_bound,answer,save as save_graph
from test_reviewing import actor,body as review_body,post as review_post,read as review_read


def setup(client):
    graph=prepare(client);report=answer(client,start_bound(client,graph).json())
    access=actor(client,"alice")
    assert review_post(client,report,access,review_body(review_read(client,report,access),"partial")).status_code==200
    return graph,report,access


def task(client,report):return client.get("/api/v1/relation-revisions/"+report["id"]).json()


def payload(current):
    return {"operation_key":str(uuid4()),"graph_revision":current["graph_revision"],"verification_revision":current["verification_revision"],"review_revision":current["review_revision"],
            "label":"token按固定编号查找嵌入表行","note":"固定词表与表行映射，顺序逐项查表；编号差不是语义距离。",
            "criteria":["path","conditions"],"reason":"补清映射与固定条件，回应原关系中遗漏的约束。","counterexample":"如果只改词表编号却不换表行，原来的查表对应会错误。"}


def post(client,report,body):return client.post("/api/v1/relation-revisions/"+report["id"],json=body)


def test_read_only_task_shows_original_current_and_review_gaps(client):
    graph,report,access=setup(client);before=client.get("/api/v1/verification").json()
    current=task(client,report)
    assert current["binding"]["edge"]["label"]==graph["payload"]["edges"][-1]["label"]
    assert current["current"]["id"]=="my-relation" and current["criteria"][0]["gap"]
    assert current["criteria"][0]["opinions"][0]["judgement"]=="partial"
    assert current["history"]==[] and current["mastery"]=="unverified"
    assert client.get("/api/v1/verification").json()==before and client.get("/api/v1/learner-graph").json()==graph


def test_save_atomically_creates_snapshot_and_retains_evidence_and_other_graph_content(client):
    graph,report,access=setup(client);current=task(client,report);body=payload(current)
    response=post(client,report,body)
    assert response.status_code==200
    result=response.json();new=client.get("/api/v1/learner-graph").json()
    assert new["revision"]==graph["revision"]+1==result["graph_revision"]
    assert new["payload"]["nodes"]==graph["payload"]["nodes"]
    assert new["payload"]["edges"][:-1]==graph["payload"]["edges"][:-1]
    assert new["payload"]["edges"][-1]["label"]==body["label"] and new["payload"]["edges"][-1]["note"]==body["note"]
    assert client.get(f"/api/v1/learner-graph/versions/{graph['revision']}").json()==graph
    history=task(client,report)["history"][0]
    assert history["before"]["label"]==graph["payload"]["edges"][-1]["label"] and history["after"]["label"]==body["label"]
    assert history["reason"]==body["reason"] and history["counterexample"]==body["counterexample"]
    assert history["source_reviews"][0]["items"][0]["judgement"]=="partial"
    assert client.get("/api/v1/verification/attempts/"+report["id"]).json()["explanation"]==report["explanation"]
    assert client.get("/api/v1/candidates?source_id="+report["id"]).json()["items"][0]["status"]=="relation_changed"
    assert result["status"]=="revised_not_verified" and result["mastery"]=="unverified"


def test_retry_same_key_returns_original_even_after_other_graph_changes(client):
    graph,report,access=setup(client);body=payload(task(client,report));first=post(client,report,body).json()
    latest=client.get("/api/v1/learner-graph").json();latest["payload"]["nodes"][0]["position"]["x"]=300
    save_graph(client,latest["payload"])
    assert post(client,report,body).json()==first
    assert len(task(client,report)["history"])==1
    assert post(client,report,{**body,"reason":"不同内容"}).status_code==409


@pytest.mark.parametrize("conflict",["graph","review","verification"])
def test_three_revision_conflicts_never_overwrite(client,conflict):
    graph,report,access=setup(client);body=payload(task(client,report))
    if conflict=="graph":
        graph["payload"]["nodes"][0]["data"]["note"]="来自另一个窗口的输入";save_graph(client,graph["payload"])
    elif conflict=="review":
        assert review_post(client,report,access,review_body(review_read(client,report,access),"unsure")).status_code==200
    else:
        state=client.get("/api/v1/verification").json()
        from test_verification import act
        review=[{"criterion":c["id"],"judgement":"unsure","quote":"","reason":"待核查"} for c in report["rubric"]]
        assert act(client,state,"self_review",attempt_id=report["id"],review=review).status_code==200
    latest=client.get("/api/v1/learner-graph").json()
    assert post(client,report,body).status_code==409
    assert client.get("/api/v1/learner-graph").json()==latest and task(client,report)["history"]==[]


def test_blank_noop_fake_or_duplicate_criteria_rejected_without_snapshot(client):
    graph,report,access=setup(client);current=task(client,report);body=payload(current)
    for change in [{"note":" "},{"reason":" "},{"counterexample":" "},{"criteria":["invented"]},{"criteria":["path","path"]},
                   {"label":current["current"]["label"],"note":current["current"]["note"]},{"label":"x"*201}]:
        assert post(client,report,{**body,**change}).status_code==422
    assert client.get("/api/v1/learner-graph").json()==graph and task(client,report)["history"]==[]


def test_unsubmitted_and_unbound_source_rejected(client):
    graph=prepare(client);state=start_bound(client,graph).json()
    assert client.get("/api/v1/relation-revisions/"+state["active"]["id"]).status_code==404
    assert client.get("/api/v1/relation-revisions/invented").status_code==404
    from test_verification import start,submit
    answer(client,state)
    ordinary=submit(client,start(client)).json()["reports"][-1]
    assert client.get("/api/v1/relation-revisions/"+ordinary["id"]).status_code==404


def test_reversed_or_deleted_edge_cannot_be_repaired_under_old_direction(client):
    graph,report,access=setup(client);body=payload(task(client,report))
    edge=graph["payload"]["edges"][-1];edge["source"],edge["target"]=edge["target"],edge["source"]
    latest=save_graph(client,graph["payload"])
    assert client.get("/api/v1/relation-revisions/"+report["id"]).status_code==409
    assert post(client,report,{**body,"graph_revision":latest["revision"]}).status_code==409
    latest["payload"]["edges"]=latest["payload"]["edges"][:-1];save_graph(client,latest["payload"])
    assert client.get("/api/v1/relation-revisions/"+report["id"]).status_code==404


def test_concurrent_revisions_create_one_snapshot_and_original_key_is_retryable(client):
    graph,report,access=setup(client);body=payload(task(client,report))
    with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda key:post(client,report,{**body,"operation_key":key}),[body["operation_key"],str(uuid4())]))
    assert sorted(r.status_code for r in results)==[200,409]
    assert client.get("/api/v1/learner-graph").json()["revision"]==graph["revision"]+1
    assert len(task(client,report)["history"])==1


def test_later_reviews_do_not_rewrite_revision_reason_snapshot(client):
    graph,report,access=setup(client);post(client,report,payload(task(client,report)))
    history=copy.deepcopy(task(client,report)["history"])
    assert review_post(client,report,access,review_body(review_read(client,report,access),"unsure")).status_code==200
    current=task(client,report)
    assert current["history"]==history and current["criteria"][0]["opinions"][0]["judgement"]=="unsure"
