import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta
from uuid import uuid4

import pytest

from app import candidates
from app.models import ReviewCase,VerificationSession
from app.reviewing import Submit
from app.verification import Action
from test_learning_loop import client
from test_reviewing import actor,body,post,read
from test_verification import start,act


def ledger(client):return client.get("/api/v1/candidates").json()


def source(client,goal="mask",choice=0,used_help=False):
    state=start(client,goal)
    result=act(client,state,"submit",attempt_id=state["active"]["id"],choice=choice,explanation="固定输入与规则后计算，范围改变时需要重新判断。",used_help=used_help)
    assert result.status_code==200
    return result.json()["reports"][-1]


def approve(client,report,headers,observe=True):
    for index,access in enumerate(headers):
        payload=body(read(client,report,access))
        if index==0 and observe:payload["observation"]={"judgement":"observed_no_help","basis":"在独立的新情境尝试期间现场观察了作答与资料使用；没有提供答案或线索。"}
        response=post(client,report,access,payload)
        assert response.status_code==200


def setup(client,**kwargs):
    report=source(client,**kwargs);headers=[actor(client,"alice"),actor(client,"bob")]
    approve(client,report,headers)
    return report,headers


def due(client,report,monkeypatch,delta=timedelta(hours=72)):
    moment=datetime.fromisoformat(report["created_at"])+delta
    monkeypatch.setattr(candidates,"now",lambda:moment)
    return ledger(client)["items"][0]


def begin(client,item):
    state=client.get("/api/v1/verification").json()
    return act(client,state,"start_recheck",parent_attempt=item["id"],parent_review_revision=item["initial"]["review_revision"])


def finish_recheck(client,state,helped=False):
    result=act(client,state,"submit",attempt_id=state["active"]["id"],choice=0,explanation="固定计算条件，先比较变化前后的关系；边界改变时重新核查。",used_help=helped)
    assert result.status_code==200
    return result.json()["reports"][-1]


def test_empty_read_creates_no_history(client):
    before=client.get("/api/v1/verification").json()
    assert ledger(client)["items"]==[]
    assert client.get("/api/v1/verification").json()==before


def test_agreed_reviews_without_observation_leave_independence_unknown(client):
    report=source(client);headers=[actor(client,"alice"),actor(client,"bob")];approve(client,report,headers,observe=False)
    item=ledger(client)["items"][0]
    assert item["status"]=="needs_evidence" and not item["initial"]["checks"][-1]["ok"]
    assert begin(client,item).status_code==409


@pytest.mark.parametrize("choice,helped",[(1,False),(None,False),(0,True)])
def test_wrong_unknown_and_helped_cannot_be_overridden_by_review_claims(client,choice,helped):
    report,headers=setup(client,choice=choice,used_help=helped)
    item=ledger(client)["items"][0]
    assert not item["initial"]["eligible"] and item["status"]=="needs_evidence"
    assert item["mastery"]=="unverified"


def test_repeat_family_is_not_new_independent_evidence(client):
    source(client);report=source(client)
    headers=[actor(client,"alice"),actor(client,"bob")];approve(client,report,headers)
    item=ledger(client)["items"][-1]
    assert not next(c for c in item["initial"]["checks"] if c["id"]=="family")["ok"]


def test_observation_requires_basis_and_assisted_claim_blocks_admission(client):
    report,headers=setup(client)
    detail=read(client,report,headers[1]);payload=body(detail)
    assert post(client,report,headers[1],{**payload,"observation":{"judgement":"observed_no_help","basis":" "}}).status_code==422
    assert post(client,report,headers[1],{**payload,"observation":{"judgement":"self_report","basis":"自报"}}).status_code==422
    response=post(client,report,headers[1],{**payload,"observation":{"judgement":"assisted","basis":"观察到本次作答中查阅了题目答案，需作为支持下尝试。"}})
    assert response.status_code==200 and ledger(client)["items"][0]["status"]=="needs_evidence"
    approve(client,report,headers)
    assert ledger(client)["items"][0]["status"]=="waiting_interval"


def test_server_enforces_72h_boundary_not_client_due_time(client,monkeypatch):
    report,headers=setup(client)
    item=due(client,report,monkeypatch,timedelta(hours=72)-timedelta(microseconds=1))
    assert item["status"]=="waiting_interval"
    state=client.get("/api/v1/verification").json()
    assert act(client,state,"start_recheck",parent_attempt=item["id"],parent_review_revision=item["initial"]["review_revision"],due_at="2000-01-01T00:00:00Z").status_code==409
    item=due(client,report,monkeypatch)
    response=begin(client,item);assert response.status_code==200
    state=response.json();assert state["active"]["kind"]=="recheck" and "correct" not in state["active"]
    assert "读取全部三个" in state["active"]["prompt"]
    with client.app.state.sessions() as session:
        event=next(e for e in session.get(VerificationSession,"local-demo").events if e.get("attempt_id")==state["active"]["id"])
        assert datetime.fromisoformat(event["created_at"])>=datetime.fromisoformat(item["due_at"])


def test_stale_source_review_revision_is_rejected(client,monkeypatch):
    report,headers=setup(client);old=due(client,report,monkeypatch)
    approve(client,report,headers)
    assert begin(client,old).status_code==409
    assert begin(client,ledger(client)["items"][0]).status_code==200


def test_full_chain_forms_candidate_only_and_reacts_to_source_disagreement(client,monkeypatch):
    report,headers=setup(client);item=due(client,report,monkeypatch)
    graph=client.get("/api/v1/learner-graph").json();journey=client.get("/api/v1/expedition").json()
    child=finish_recheck(client,begin(client,item).json())
    assert ledger(client)["items"][0]["status"]=="recheck_needs_evidence"
    approve(client,child,headers)
    assert ledger(client)["items"][0]["status"]=="candidate_ready"
    changed=body(read(client,report,headers[1]),"partial")
    assert post(client,report,headers[1],changed).status_code==200
    assert ledger(client)["items"][0]["status"]=="needs_evidence"
    approve(client,report,headers)
    fresh=ledger(client)["items"][0]
    assert fresh["status"]=="candidate_ready" and fresh["mastery"]=="unverified"
    assert client.get("/api/v1/learner-graph").json()==graph and client.get("/api/v1/expedition").json()==journey
    assert client.get("/api/v1/verification").json()["reports"][-1]["explanation"]==child["explanation"]


def test_helped_recheck_cannot_be_retried_into_new_evidence(client,monkeypatch):
    report,headers=setup(client);item=due(client,report,monkeypatch)
    child=finish_recheck(client,begin(client,item).json(),helped=True);approve(client,child,headers)
    fresh=ledger(client)["items"][0]
    assert fresh["status"]=="recheck_needs_evidence" and not fresh["recheck"]["eligible"]
    assert begin(client,fresh).status_code==409


def test_concurrent_recheck_start_and_idempotent_retry(client,monkeypatch):
    report,headers=setup(client);item=due(client,report,monkeypatch)
    with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:begin(client,item),range(2)))
    assert sorted(r.status_code for r in results)==[200,409]
    winner=next(r for r in results if r.status_code==200)
    assert client.post("/api/v1/verification/actions",json=json.loads(winner.request.content)).json()==winner.json()


def test_old_review_and_verification_operation_keys_remain_retryable(client):
    state=start(client)
    with client.app.state.sessions() as session,session.begin():
        row=session.get(VerificationSession,"local-demo");event=row.events[0]
        original=Action(base_revision=0,operation_key=event["key"],action="start",goal="mask")
        event["hash"]=hashlib.sha256(original.model_dump_json(exclude={"parent_attempt","parent_review_revision","edge_id","graph_revision","relation_template"}).encode()).hexdigest()
        row.events=[event]
    assert client.post("/api/v1/verification/actions",json=original.model_dump(exclude={"parent_attempt","parent_review_revision","edge_id","graph_revision","relation_template"})).json()==state
    report=act(client,state,"submit",attempt_id=state["active"]["id"],choice=0,explanation="固定条件，再解释影响路径。").json()["reports"][-1]
    access=actor(client,"alice");payload=body(read(client,report,access));response=post(client,report,access,payload).json()
    with client.app.state.sessions() as session,session.begin():
        case=session.get(ReviewCase,report["id"]);event=case.events[0];event.pop("observation")
        normalized=Submit(**payload).model_dump(exclude={"observation"})
        event["hash"]=hashlib.sha256(json.dumps({"actor":"alice",**normalized},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        case.events=[event]
    assert post(client,report,access,payload).json()==response


@pytest.mark.parametrize("goal,correct",[("mask",0),("weights",1),("lookup",1),("loss",1)])
def test_four_recheck_variants_pin_new_structural_relationships(client,monkeypatch,goal,correct):
    report,headers=setup(client,goal=goal,choice=correct);item=due(client,report,monkeypatch)
    state=begin(client,item).json()
    assert state["active"]["prompt"]!=report["prompt"] and state["active"]["version"]!=report["task_version"]
    child=finish_recheck(client,state);assert child["choice_matches"] is True and child["parent_attempt"]==report["id"]
    assert child["evidence_policy"]==candidates.POLICY


def test_policy_change_requires_explicit_review(client,monkeypatch):
    report,headers=setup(client);item=due(client,report,monkeypatch)
    child=finish_recheck(client,begin(client,item).json());approve(client,child,headers)
    monkeypatch.setattr(candidates,"POLICY","future-policy-not-migrated")
    assert ledger(client)["items"][0]["status"]=="needs_policy_review"


def test_old_eligible_source_remains_startable_beyond_first_page(client,monkeypatch):
    report,headers=setup(client);item=due(client,report,monkeypatch)
    with client.app.state.sessions() as session,session.begin():
        row=session.get(VerificationSession,"local-demo");events=list(row.events)
        first=events[0];answer=events[1]
        for _ in range(51):
            identity=str(uuid4())
            events.extend([{**{k:v for k,v in first.items() if k!="result"},"attempt_id":identity,"key":str(uuid4()),"repeat_family":True},
                           {**{k:v for k,v in answer.items() if k!="result"},"attempt_id":identity,"key":str(uuid4())}])
        row.events=events;row.revision=len(events)
    page=ledger(client)
    assert page["total"]==52 and len(page["items"])==50 and page["next_offset"]==50
    assert all(c["id"]!=report["id"] for c in page["items"])
    older=client.get("/api/v1/candidates?offset=50").json()
    assert any(c["id"]==report["id"] for c in older["items"])
    assert client.get("/api/v1/candidates?offset=-1").status_code==422
    assert begin(client,item).status_code==200
