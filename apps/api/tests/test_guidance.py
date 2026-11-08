from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest

from sqlalchemy import select

from app.models import AdventureSession
from test_learning_loop import client, reach_query


def get(client): return client.get("/api/v1/guidance").json()


def act(client, state, action="feedback", **extra):
    target=state["target"]
    return client.post("/api/v1/guidance/actions",json={"base_revision":state["revision"],"operation_key":str(uuid4()),
        "action":action,"target":target["id"],"stage":target["stage"],**extra})


def test_read_only_hides_locked_and_keeps_unknown(client):
    graph=client.get("/api/v1/learner-graph").json()
    before=client.get("/api/v1/expedition").json()
    state=get(client)
    assert state["target"]["id"] == "mask" and len(state["available"]) == 1
    assert state["task"] is None and "保留未知" in state["profile_note"]
    assert client.get("/api/v1/learner-graph").json() == graph
    assert client.get("/api/v1/expedition").json() == before


def test_hard_causes_separate_operations_from_concepts(client):
    state=act(client,get(client),feedback="hard",cause="operation").json()
    assert state["task"] is None and "操作困难不记为知识薄弱" in state["reason"]
    state=act(client,state,feedback="hard",cause="term").json()
    assert state["task"]["bridge"] and state["task"]["kind"] == "支持下练习"
    assert "correct" not in state["task"] and state["task"]["hint"] is None
    state=act(client,state,"answer",task_id=state["task"]["id"],choice=0).json()
    assert state["history"][-1]["outcome"] == "supported_choice"
    assert state["mastery"] == "unverified"
    assert client.get("/api/v1/adventure").json()["stage"] == 0


def test_easy_probe_hint_and_prior_support_never_become_independent(client):
    state=act(client,get(client),feedback="easy").json()
    assert state["task"]["bridge"] is None and state["task"]["kind"] == "独立选择探测"
    state=act(client,state,"hint",task_id=state["task"]["id"]).json()
    assert state["task"]["hint"] and state["task"]["kind"] == "支持下练习"
    state=act(client,state,"answer",task_id=state["task"]["id"],choice=0).json()
    assert state["history"][-1]["outcome"] == "supported_choice"
    state=act(client,state,feedback="example").json()
    assert "位置2可读" in state["task"]["prompt"]
    state=act(client,state,feedback="easy").json()
    assert state["task"]["kind"] == "支持下练习"
    with client.app.state.sessions() as session:
        row=session.get(AdventureSession,"local-demo");row.stage=1;session.commit()
    state=act(client,get(client),feedback="easy").json()
    assert state["target"]["stage"] == 1 and state["task"]["kind"] == "支持下练习"


def test_independent_choice_wrong_and_unknown_are_not_mastery(client):
    state=act(client,get(client),feedback="easy").json()
    state=act(client,state,"answer",task_id=state["task"]["id"],choice=0).json()
    assert state["history"][-1]["outcome"] == "independent_choice"
    state=act(client,state,"answer",task_id=state["task"]["id"],choice=1).json()
    assert state["history"][-1]["outcome"] == "needs_check"
    assert state["task"]["bridge"] and "不据此整章降级" in state["reason"]
    state=act(client,state,"answer",task_id=state["task"]["id"],choice=None).json()
    assert state["history"][-1]["outcome"] == "unknown" and state["mastery"] == "unverified"


def test_locked_target_rejected_progress_changes_expire_old_task(client):
    state=get(client)
    assert act(client,state,"choose",target="token").status_code == 409
    state=act(client,state,feedback="hard",cause="concept").json()
    reach_query(client)
    assert act(client,state,"answer",task_id=state["task"]["id"],choice=0).status_code == 409
    fresh=get(client)
    assert fresh["target"]["id"] == "query"
    fresh=act(client,fresh,feedback="example").json()
    assert fresh["task"] is None and "覆盖缺口" in fresh["reason"]


def test_retry_and_first_concurrency_do_not_duplicate_feedback(client):
    state=get(client)
    body={"base_revision":0,"operation_key":str(uuid4()),"action":"feedback","target":"mask","stage":0,"feedback":"easy"}
    first=client.post("/api/v1/guidance/actions",json=body)
    assert first.status_code == 200 and client.post("/api/v1/guidance/actions",json=body).json() == first.json()
    assert client.post("/api/v1/guidance/actions",json={**body,"feedback":"example"}).status_code == 409
    state=get(client)
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:act(client,state,feedback="easy").status_code,range(2)))
    assert sorted(results) == [200,409] and get(client)["revision"] == 2


def test_optional_choice_and_all_explored_boundary(client):
    reach_query(client)
    with client.app.state.sessions() as session:
        row=session.get(AdventureSession,"local-demo:query");row.stage=3;session.commit()
    state=get(client)
    assert state["target"]["id"] == "beacon"
    state=act(client,state,"choose",target="heads").json()
    assert state["target"]["id"] == "heads"
    with client.app.state.sessions() as session:
        for row in session.scalars(select(AdventureSession)).all(): row.stage=3
        session.commit()
    assert get(client)["target"] is None


def test_feedback_validation_and_stage_scope(client):
    state=get(client)
    assert act(client,state,feedback="hard").status_code == 422
    assert act(client,state,feedback="hard",cause="invented").status_code == 422
    assert act(client,state,"answer",task_id="fake",choice=0).status_code == 409
    assert get(client)["revision"] == 0


def test_concurrent_first_creation(client):
    initial=get(client)
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:act(client,initial,feedback="easy").status_code,range(2)))
    assert sorted(results) == [200,409] and get(client)["revision"] == 1


@pytest.mark.parametrize("node,correct",[("mask",0),("prism",1),("token",0),("embedding",0),("loss",2)])
def test_each_supported_mechanism_has_scoped_feedback_without_progress_writes(client,node,correct):
    with client.app.state.sessions() as session:
        for row in session.scalars(select(AdventureSession)).all(): row.stage=3
        key="local-demo" if node=="mask" else f"local-demo:{node}"
        session.get(AdventureSession,key).stage=0
        session.commit()
    before=client.get("/api/v1/expedition").json()
    state=act(client,get(client),feedback="hard",cause="concept").json()
    assert state["target"]["id"] == node and state["task"]["bridge"]
    state=act(client,state,"answer",task_id=state["task"]["id"],choice=correct).json()
    assert state["history"][-1]["outcome"] == "supported_choice"
    assert client.get("/api/v1/expedition").json() == before
