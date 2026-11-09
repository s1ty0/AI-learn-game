from uuid import uuid4
from sqlalchemy import select

from app.models import AdventureSession,VerificationSession
from test_learning_loop import client
from test_candidates import setup,due,begin,finish_recheck,approve
from test_verification import start,submit
from test_reviewing import body,read,post


def discover(client,*nodes):
    with client.app.state.sessions() as session,session.begin():
        for node in nodes:session.get(AdventureSession,"local-demo" if node=="mask" else "local-demo:"+node).stage=3


def test_empty_read_does_not_reveal_locked_or_mutate_graph(client):
    before=client.get("/api/v1/learner-graph").json();verification=client.get("/api/v1/verification").json()
    assert client.get("/api/v1/star-evidence").json()["entities"]==[]
    assert client.get("/api/v1/star-evidence/entity-0073").status_code==404
    assert client.get("/api/v1/learner-graph").json()==before and client.get("/api/v1/verification").json()==verification


def test_mapping_is_narrow_and_unsupported_concepts_stay_unknown(client):
    discover(client,"mask","prism","token")
    summary=client.get("/api/v1/star-evidence").json()
    summaries={e["id"]:e for e in summary["entities"]}
    assert summaries["entity-0068"]["covered"] and not summaries["entity-0142"]["covered"]
    assert summaries["entity-0142"]["counts"]=={}
    token=client.get("/api/v1/star-evidence/entity-0144").json()
    assert token["goals"][0]["id"]=="lookup" and not token["goals"][0]["available"]
    assert "编号" in token["goals"][0]["bridge"] and token["total"]==0
    discover(client,"embedding")
    assert client.get("/api/v1/star-evidence/entity-0144").json()["goals"][0]["available"] is True


def test_current_candidate_and_reviewer_changes_project_without_writing_old_graph(client,monkeypatch):
    source,headers=setup(client);item=due(client,source,monkeypatch)
    graph=client.get("/api/v1/learner-graph").json()
    first=client.get("/api/v1/star-evidence/entity-0068").json()
    assert first["items"][0]["status"]=="ready_for_recheck" and first["scope"]=="current_evidence"
    child=finish_recheck(client,begin(client,item).json());approve(client,child,headers)
    assert client.get("/api/v1/star-evidence").json()["entities"][0]["counts"]["candidate_ready"]==1
    assert post(client,source,headers[1],body(read(client,source,headers[1]),"partial")).status_code==200
    changed=client.get("/api/v1/star-evidence/entity-0068").json()
    assert changed["items"][0]["status"]=="needs_evidence" and changed["mastery"]=="unverified"
    assert client.get("/api/v1/learner-graph").json()==graph
    assert client.get(f"/api/v1/learner-graph/versions/{graph['revision']}").json()==graph


def test_entity_filter_does_not_attach_unrelated_goal_to_star(client):
    source,headers=setup(client)
    discover(client,"loss","prism")
    assert client.get("/api/v1/star-evidence/entity-0014").json()["items"]==[]
    assert client.get("/api/v1/star-evidence/entity-0147").json()["items"]==[]
    assert client.get("/api/v1/star-evidence/entity-0138").json()["goals"]==[]
    assert client.get("/api/v1/star-evidence/entity-0068").json()["items"][0]["id"]==source["id"]


def test_evidence_detail_has_no_private_answer_or_future_recheck(client):
    discover(client,"mask")
    state=start(client)
    payload=client.get("/api/v1/star-evidence/entity-0068").json()
    assert payload["items"]==[] and "correct" not in str(payload) and "criteria" not in str(payload)
    assert client.get("/api/v1/verification/attempts/"+state["active"]["id"]).status_code==404
    assert client.get("/api/v1/verification/attempts/invented").status_code==404


def test_historical_report_can_be_read_beyond_recent_ten_without_active_answers(client):
    original=submit(client,start(client)).json()["reports"][-1]
    for _ in range(12):submit(client,start(client))
    active=start(client)
    assert all(r["id"]!=original["id"] for r in active["reports"])
    exact=client.get("/api/v1/verification/attempts/"+original["id"]).json()
    assert exact==original and "active" not in exact and "key" not in exact


def test_source_filter_matches_only_specified_candidate(client):
    original=submit(client,start(client)).json()["reports"][-1]
    another=submit(client,start(client)).json()["reports"][-1]
    filtered=client.get("/api/v1/candidates?source_id="+original["id"]).json()
    assert filtered["total"]==1 and filtered["items"][0]["id"]==original["id"]
    assert client.get("/api/v1/candidates?source_id="+str(uuid4())).json()["items"]==[]
    assert client.get("/api/v1/candidates?source_id=").status_code==422


def test_entity_evidence_pagination_keeps_older_sources(client):
    report=submit(client,start(client)).json()["reports"][-1]
    with client.app.state.sessions() as session,session.begin():
        row=session.get(VerificationSession,"local-demo");events=list(row.events);first=events[0];answer=events[1]
        for _ in range(51):
            identity=str(uuid4())
            events.extend([{**{k:v for k,v in first.items() if k!="result"},"attempt_id":identity,"key":str(uuid4()),"repeat_family":True},
                           {**{k:v for k,v in answer.items() if k!="result"},"attempt_id":identity,"key":str(uuid4())}])
        row.events=events;row.revision=len(events)
    page=client.get("/api/v1/star-evidence/entity-0068").json()
    assert page["total"]==52 and page["next_offset"]==50 and len(page["items"])==50
    older=client.get("/api/v1/star-evidence/entity-0068?offset=50").json()
    assert any(i["id"]==report["id"] for i in older["items"])
    assert client.get("/api/v1/star-evidence/entity-0068?offset=-1").status_code==422
    assert client.get("/api/v1/star-evidence").json()["entities"][0]["counts"]["needs_evidence"]==52
