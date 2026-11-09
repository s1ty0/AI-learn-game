import copy
import hashlib
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app import revision_challenges
from app.models import VerificationSession
from test_learning_loop import client
from test_relation_evidence import prepare,start_bound,answer,save as save_graph
from test_relation_revisions import task,payload,post
from test_verification import act
from app.verification import Action
from test_candidates import approve
from test_reviewing import actor


def saved(client,template="lookup-map",criteria=None):
    graph=prepare(client,template);report=answer(client,start_bound(client,graph,template).json())
    body=payload(task(client,report));body["criteria"]=criteria or ["path","conditions","boundary"]
    if template=="mse-example":body.update(label="按各样本误差平方的平均值选择模型",note="同一评估集逐样本等权比较，不代表未来或每个样本都更好。")
    result=post(client,report,body)
    assert result.status_code==200
    return result.json(),report


def preview(client,repair):return client.get("/api/v1/relation-revisions/challenge/"+repair["id"])


def start(client,repair,focus="path",**changes):
    state=client.get("/api/v1/verification").json()
    return act(client,state,"start_revision_challenge",revision_id=repair["id"],revision_focus=focus,graph_revision=client.get("/api/v1/learner-graph").json()["revision"],**changes)


@pytest.mark.parametrize("template",["lookup-map","mse-example"])
@pytest.mark.parametrize("focus",["path","conditions","boundary"])
def test_six_families_hide_answers_pin_repair_and_give_scoped_feedback(client,template,focus):
    repair,source=saved(client,template);before=client.get("/api/v1/learner-graph").json()
    check=preview(client,repair);assert check.status_code==200
    assert "correct" not in str(check.json()) and "rationale" not in str(check.json())
    response=start(client,repair,focus);assert response.status_code==200
    state=response.json();active=state["active"]
    assert active["kind"]=="revision_challenge" and active["revision_origin"]["revision_id"]==repair["id"]
    assert repair["after"]["label"] in active["prompt"] and not active["repeat_family"]
    assert not {"correct","rationale","rubric","target_feedback"}&set(active)
    assert client.get("/api/v1/verification/attempts/"+active["id"]).status_code==404
    correct=revision_challenges.SCENARIOS[(template,focus)][2]
    submitted=act(client,state,"submit",attempt_id=active["id"],choice=correct,explanation="按新情境逐步检查条件，并核对新命题是否仍有过度概括。")
    assert submitted.status_code==200
    report=submitted.json()["reports"][-1]
    assert report["target_feedback"]["selection"]=="matches" and report["target_feedback"]["gap_status"]=="not_established"
    assert report["binding"]["edge"]==repair["after"] and report["status"]=="pending_review"
    assert client.get("/api/v1/learner-graph").json()==before
    assert client.get("/api/v1/candidates?source_id="+report["id"]).json()["items"]==[]
    entity="entity-0073" if template=="lookup-map" else "entity-0014"
    assert client.get("/api/v1/star-evidence/"+entity).json()["items"]==[]
    history=task(client,source)["history"][-1]
    assert history["challenges"][-1]["id"]==report["id"] and history["challenges"][-1]["submitted"]
    retry=start(client,repair,focus).json();assert retry["active"]["repeat_family"]


@pytest.mark.parametrize("choice,expected",[(None,"unknown"),(0,"mismatch")])
def test_uncertain_or_wrong_prediction_does_not_claim_gap_fixed(client,choice,expected):
    repair,_=saved(client);state=start(client,repair).json()
    report=act(client,state,"submit",attempt_id=state["active"]["id"],choice=choice,explanation="不确定，请保留我的尝试。").json()["reports"][-1]
    assert report["target_feedback"]["selection"]==expected
    assert report["target_feedback"]["explanation_status"]=="pending_review"


def test_read_only_preview_and_same_key_retry_after_graph_changes(client):
    repair,_=saved(client);before=client.get("/api/v1/verification").json()
    assert preview(client,repair).status_code==200 and client.get("/api/v1/verification").json()==before
    body={"base_revision":before["revision"],"operation_key":str(uuid4()),"action":"start_revision_challenge","revision_id":repair["id"],"revision_focus":"path","graph_revision":repair["graph_revision"]}
    first=client.post("/api/v1/verification/actions",json=body)
    graph=client.get("/api/v1/learner-graph").json();graph["payload"]["edges"][-1]["note"]="后来改动，不能覆盖原题";save_graph(client,graph["payload"])
    assert client.post("/api/v1/verification/actions",json=body).json()==first.json()
    assert client.post("/api/v1/verification/actions",json={**body,"revision_focus":"conditions"}).status_code==409


@pytest.mark.parametrize("change",["label","note","reverse","delete"])
def test_stale_or_removed_proposition_cannot_start_old_repair(client,change):
    repair,_=saved(client);graph=client.get("/api/v1/learner-graph").json();edge=graph["payload"]["edges"][-1]
    if change in {"label","note"}:edge[change]="另一个版本的关系"
    elif change=="reverse":edge["source"],edge["target"]=edge["target"],edge["source"]
    else:graph["payload"]["edges"].pop()
    save_graph(client,graph["payload"])
    expected=404 if change=="delete" else 409
    assert preview(client,repair).status_code==expected and start(client,repair).status_code==expected


def test_focus_source_and_preflight_graph_revision_are_enforced(client):
    repair,_=saved(client,criteria=["conditions"])
    assert start(client,repair,"path").status_code==422
    assert start(client,{**repair,"id":"invented"}).status_code==404
    assert start(client,repair,"conditions",parent_attempt="invented").status_code==422
    state=client.get("/api/v1/verification").json();graph=client.get("/api/v1/learner-graph").json()
    graph["payload"]["nodes"][0]["position"]["x"]+=1;save_graph(client,graph["payload"])
    assert act(client,state,"start_revision_challenge",revision_id=repair["id"],revision_focus="conditions",graph_revision=repair["graph_revision"]).status_code==409
    assert preview(client,repair).status_code==200
    assert act(client,state,"start",goal="lookup",revision_id=repair["id"]).status_code==422


def test_different_repair_words_never_reset_family_and_no_recheck_admission(client):
    repair,source=saved(client);state=start(client,repair).json();report=answer(client,state)
    assert act(client,client.get("/api/v1/verification").json(),"start_recheck",parent_attempt=report["id"],parent_review_revision=0).status_code==404
    body=payload(task(client,source));body["label"]+="，补充适用范围"
    newer=post(client,source,body).json()
    repeated=start(client,newer).json()["active"]
    assert repeated["repeat_family"] and repeated["revision_origin"]["revision_id"]==newer["id"]


def test_concurrent_start_preserves_single_active_and_source_history(client):
    repair,source=saved(client);before=copy.deepcopy(task(client,source)["history"])
    with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:start(client,repair),range(2)))
    assert sorted(r.status_code for r in results)==[200,409]
    latest=task(client,source)["history"]
    assert latest[0]["after"]==before[0]["after"] and len(latest[0]["challenges"])==1
    with client.app.state.sessions() as session:
        row=session.get(VerificationSession,"local-demo")
        assert sum(e["action"]=="relation_revision" for e in row.events)==1


def test_practice_can_be_reviewed_but_agreement_does_not_admit_candidate(client):
    repair,_=saved(client);report=answer(client,start(client,repair).json())
    approve(client,report,[actor(client,"alice"),actor(client,"bob")])
    exact=client.get("/api/v1/verification/attempts/"+report["id"]).json()
    assert exact["review_state"]["status"]=="consistent_review"
    assert exact["target_feedback"]["gap_status"]=="not_established"
    assert client.get("/api/v1/candidates?source_id="+report["id"]).json()["items"]==[]


def test_pre_challenge_bound_operation_digest_remains_retryable(client):
    graph=prepare(client);before=client.get("/api/v1/verification").json()
    action=Action(base_revision=before["revision"],operation_key=str(uuid4()),action="start_relation",edge_id="my-relation",graph_revision=graph["revision"],relation_template="lookup-map")
    payload=action.model_dump(exclude={"revision_id","revision_focus"})
    first=client.post("/api/v1/verification/actions",json=payload)
    assert first.status_code==200
    with client.app.state.sessions() as session,session.begin():
        row=session.get(VerificationSession,"local-demo");event=row.events[-1]
        event["hash"]=hashlib.sha256(action.model_dump_json(exclude={"revision_id","revision_focus"}).encode()).hexdigest()
        row.events=[*row.events[:-1],event]
    assert client.post("/api/v1/verification/actions",json=payload).json()==first.json()
