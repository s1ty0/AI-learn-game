from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app.models import AdventureSession
from app.verification_content import TASKS
from test_learning_loop import client


def unlock(client,node="mask"):
    with client.app.state.sessions() as session:
        key="local-demo" if node=="mask" else f"local-demo:{node}"
        session.get(AdventureSession,key).stage=3
        session.commit()


def get(client):return client.get("/api/v1/verification").json()


def act(client,state,action,**extra):
    return client.post("/api/v1/verification/actions",json={"base_revision":state["revision"],"operation_key":str(uuid4()),"action":action,**extra})


def start(client,goal="mask"):
    unlock(client,TASKS[goal]["node"])
    return act(client,get(client),"start",goal=goal).json()


def submit(client,state,**extra):
    return act(client,state,"submit",attempt_id=state["active"]["id"],explanation="只改变范围外的值，可读输入和规则均固定。若允许读取位置3则需重算。",choice=0,**extra)


def test_read_only_empty_and_locked_start(client):
    graph=client.get("/api/v1/learner-graph").json();before=client.get("/api/v1/expedition").json()
    state=get(client)
    assert state["goals"]==[] and state["active"] is None and state["reports"]==[]
    assert act(client,state,"start",goal="loss").status_code==409
    assert client.get("/api/v1/learner-graph").json()==graph and client.get("/api/v1/expedition").json()==before


def test_active_hides_answers_and_rubric_until_submit(client):
    state=start(client)
    assert "correct" not in state["active"] and "rubric" not in state["active"] and "rationale" not in state["active"]
    assert act(client,state,"self_review",attempt_id=state["active"]["id"]).status_code==409
    assert act(client,state,"start",goal="mask").status_code==409
    assert get(client)==state


def test_correct_choice_and_explanation_remain_pending_and_bind_graph_snapshot(client):
    state=start(client);graph=client.get("/api/v1/learner-graph").json()
    result=submit(client,state).json();report=result["reports"][-1]
    assert report["choice_matches"] is True and report["status"]=="pending_review"
    assert report["independence"]=="not_established" and result["mastery"]=="unverified"
    assert report["graph_revision"]==graph["revision"] and report["release_id"]
    assert len(report["rubric"])==3 and report["rationale"]
    assert client.get("/api/v1/learner-graph").json()==graph


def test_wrong_choice_keyword_text_does_not_pass(client):
    state=start(client)
    result=act(client,state,"submit",attempt_id=state["active"]["id"],choice=1,explanation="因果掩码 可读输入 固定规则 边界；所以位置2一定增大10倍。").json()
    report=result["reports"][-1]
    assert report["choice_matches"] is False and report["status"]=="pending_review"
    assert result["mastery"]=="unverified"


def test_self_review_cites_original_and_never_certifies(client):
    state=submit(client,start(client)).json();report=state["reports"][-1]
    review=[{"criterion":c["id"],"judgement":"met","quote":"固定","reason":"这是本人的复盘判断，仍需他人核查。"} for c in report["rubric"]]
    next=act(client,state,"self_review",attempt_id=report["id"],review=review).json()
    assert next["reports"][-1]["status"]=="pending_review" and next["mastery"]=="unverified"
    assert next["reports"][-1]["explanation"]==report["explanation"]
    assert len(next["reports"][-1]["self_reviews"])==1
    later=act(client,next,"self_review",attempt_id=report["id"],review=[{**i,"judgement":"unsure","quote":""} for i in review]).json()
    assert len(later["reports"][-1]["self_reviews"])==2


def test_invalid_review_quote_omissions_and_duplicates_rejected(client):
    state=submit(client,start(client)).json();report=state["reports"][-1]
    review=[{"criterion":c["id"],"judgement":"met","quote":"不存在的原文","reason":"解释"} for c in report["rubric"]]
    assert act(client,state,"self_review",attempt_id=report["id"],review=review).status_code==422
    assert act(client,state,"self_review",attempt_id=report["id"],review=review[:2]).status_code==422
    assert act(client,state,"self_review",attempt_id=report["id"],review=[review[0]]*3).status_code==422
    assert get(client)==state


def test_repeat_family_and_self_reported_help_cannot_be_independent(client):
    state=submit(client,start(client),used_help=True).json()
    assert state["reports"][-1]["independence"]=="supported"
    state=act(client,state,"start",goal="mask").json()
    assert state["active"]["repeat_family"] is True
    state=submit(client,state).json()
    assert state["reports"][-1]["independence"]=="repeat_family" and len(state["reports"])==2


def test_retry_returns_original_result_and_conflicting_first_starts_serialize(client):
    unlock(client);state=get(client)
    body={"base_revision":0,"operation_key":str(uuid4()),"action":"start","goal":"mask"}
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda key:client.post("/api/v1/verification/actions",json={**body,"operation_key":key}),[body["operation_key"],str(uuid4())]))
    assert sorted(r.status_code for r in results)==[200,409]
    winner=next(r for r in results if r.status_code==200)
    winning_body=__import__("json").loads(winner.request.content)
    assert client.post("/api/v1/verification/actions",json=winning_body).json()==winner.json()
    assert client.post("/api/v1/verification/actions",json={**winning_body,"goal":"loss"}).status_code==409


def test_bounds_and_submitted_original_cannot_be_overwritten(client):
    state=start(client);attempt=state["active"]["id"]
    for text in [" ","x"*5001]:
        assert act(client,state,"submit",attempt_id=attempt,explanation=text).status_code==422
    state=submit(client,state).json()
    assert act(client,state,"submit",attempt_id=attempt,explanation="覆盖原文",choice=1).status_code==409


def test_active_task_and_rubric_are_pinned_when_content_changes(client,monkeypatch):
    state=start(client)
    monkeypatch.setitem(TASKS,"mask",{**TASKS["mask"],"correct":2,"rationale":"后来修改的草稿"})
    report=submit(client,state).json()["reports"][-1]
    assert report["choice_matches"] is True and report["rationale"]!="后来修改的草稿"


@pytest.mark.parametrize("goal,correct",[("mask",0),("weights",1),("lookup",1),("loss",1)])
def test_each_transfer_task_has_separate_prediction_and_explanation_review(client,goal,correct):
    state=start(client,goal)
    result=act(client,state,"submit",attempt_id=state["active"]["id"],choice=correct,explanation="这是我的独立尝试，具体关系仍待检查。").json()
    assert result["reports"][-1]["choice_matches"] is True
    assert result["reports"][-1]["status"]=="pending_review"
