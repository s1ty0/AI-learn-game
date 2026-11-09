import hashlib
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app.models import ReviewActor, ReviewCase
from test_learning_loop import client
from test_verification import start,submit as submit_answer


def actor(client,identity):
    key="fixture-review-key-"+identity
    with client.app.state.sessions() as session,session.begin():
        session.add(ReviewActor(id=identity,name="复核者"+identity,token_hash=hashlib.sha256(key.encode()).hexdigest(),enabled=1))
    return {"Authorization":"Bearer "+key}


def attempt(client):return submit_answer(client,start(client)).json()["reports"][-1]


def read(client,report,headers):return client.get("/api/v1/reviewing/"+report["id"],headers=headers).json()


def body(detail,judgement="met"):
    return {"base_revision":detail["revision"],"operation_key":str(uuid4()),"supersedes":detail["own_latest"]["id"] if detail["own_latest"] else None,
            "correction_reason":"重新核对了成立条件和原文依据。" if detail["own_latest"] else "",
            "items":[{"criterion":c["id"],"judgement":judgement,"quote":"固定" if judgement in {"met","partial"} else "","reason":"依据题设与这段原文判断，仍不推断其他目标掌握。"} for c in detail["rubric"]]}


def post(client,report,headers,payload):return client.post("/api/v1/reviewing/"+report["id"],headers=headers,json=payload)


def test_unauthorized_queue_and_detail_are_blocked(client):
    for path in ["/api/v1/reviewing","/api/v1/reviewing/me","/api/v1/reviewing/any"]:
        assert client.get(path).status_code==401
        assert client.get(path,headers={"Authorization":"Bearer invented"}).status_code==401
    assert client.post("/api/v1/reviewing/any",json={}).status_code==401
    assert client.get("/api/v1/reviewing",headers=actor(client,"local-demo")).status_code==401


def test_server_identity_cannot_be_forged_by_body(client):
    report=attempt(client);headers=actor(client,"alice");detail=read(client,report,headers)
    assert client.get("/api/v1/reviewing/me",headers=headers).json()["id"]=="alice"
    assert post(client,report,headers,{**body(detail),"actor":"bob"}).status_code==422
    result=post(client,report,headers,body(detail)).json()
    assert result["own_latest"]["actor"]=="alice"
    assert "token_hash" not in str(result) and "operation_key" not in str(result)


def test_queue_excludes_unsubmitted_and_supports_pages(client):
    headers=actor(client,"alice");active=start(client)
    assert client.get("/api/v1/reviewing/"+active["active"]["id"],headers=headers).status_code==404
    assert client.get("/api/v1/reviewing",headers=headers).json()["total"]==0
    submit_answer(client,active)
    for _ in range(20):attempt(client)
    page=client.get("/api/v1/reviewing",headers=headers).json()
    assert len(page["items"])==20 and page["next_offset"]==20 and page["total"]==21
    assert len(client.get("/api/v1/reviewing?offset=20",headers=headers).json()["items"])==1
    assert client.get("/api/v1/reviewing?offset=-1",headers=headers).status_code==422


def test_single_review_is_not_mastery_and_does_not_change_original(client):
    report=attempt(client);headers=actor(client,"alice");graph=client.get("/api/v1/learner-graph").json()
    result=post(client,report,headers,body(read(client,report,headers))).json()
    assert result["review_state"]["status"]=="single_review"
    learner=client.get("/api/v1/verification").json()["reports"][-1]
    assert learner["explanation"]==report["explanation"] and learner["status"]=="pending_review"
    assert learner["review_state"]["mastery"]=="unverified" and client.get("/api/v1/learner-graph").json()==graph


def test_first_review_hides_peers_then_reports_criterion_disagreement(client):
    report=attempt(client);a=actor(client,"alice");b=actor(client,"bob")
    post(client,report,a,body(read(client,report,a)))
    second=read(client,report,b)
    assert second["peers_hidden"] and second["review_state"]["history"]==[] and second["own_latest"] is None
    changed=body(second);changed["items"][1]["judgement"]="partial"
    result=post(client,report,b,changed).json()
    assert result["review_state"]["status"]=="disputed" and result["review_state"]["disagreements"]==["conditions"]
    assert not result["peers_hidden"] and len(result["review_state"]["history"])==2


def test_correction_only_supersedes_own_latest_and_history_is_retained(client):
    report=attempt(client);a=actor(client,"alice");b=actor(client,"bob")
    first=post(client,report,a,body(read(client,report,a))).json()
    post(client,report,b,body(read(client,report,b),"partial"))
    detail=read(client,report,b);original=detail["own_latest"]
    correction=body(detail)
    assert post(client,report,b,{**correction,"supersedes":first["own_latest"]["id"]}).status_code==409
    assert post(client,report,b,{**correction,"correction_reason":" "}).status_code==422
    result=post(client,report,b,correction).json()
    assert result["review_state"]["status"]=="consistent_review" and result["review_state"]["reviewer_count"]==2
    assert len(result["review_state"]["history"])==3
    assert result["review_state"]["history"][1]==original and result["own_latest"]["supersedes"]==original["id"]
    assert result["review_state"]["mastery"]=="unverified"


def test_agreement_on_uncertainty_or_missing_requires_followup(client):
    report=attempt(client);a=actor(client,"alice");b=actor(client,"bob")
    post(client,report,a,body(read(client,report,a),"unsure"))
    result=post(client,report,b,body(read(client,report,b),"unsure")).json()
    assert result["review_state"]["status"]=="needs_followup" and result["review_state"]["disagreements"]==[]


def test_agreed_marks_do_not_override_wrong_prediction(client):
    state=start(client)
    from test_verification import act
    report=act(client,state,"submit",attempt_id=state["active"]["id"],choice=1,explanation="固定条件下我仍猜会增大，原因需要核查。").json()["reports"][-1]
    a=actor(client,"alice");b=actor(client,"bob")
    post(client,report,a,body(read(client,report,a)))
    result=post(client,report,b,body(read(client,report,b))).json()
    assert result["review_state"]["status"]=="needs_followup"


def test_invalid_quotes_duplicates_and_blank_reasons_rejected(client):
    report=attempt(client);a=actor(client,"alice");payload=body(read(client,report,a))
    bad={**payload,"items":[{**item,"quote":"不存在于原文"} for item in payload["items"]]}
    assert post(client,report,a,bad).status_code==422
    assert post(client,report,a,{**payload,"items":[payload["items"][0]]*3}).status_code==422
    assert post(client,report,a,{**payload,"items":[{**i,"reason":" "} for i in payload["items"]]}).status_code==422
    assert read(client,report,a)["revision"]==0


def test_idempotent_retry_is_bound_to_actor_and_first_case_concurrency_serializes(client):
    report=attempt(client);a=actor(client,"alice");b=actor(client,"bob");payload=body(read(client,report,a))
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda headers:post(client,report,headers,payload),[a,b]))
    assert sorted(r.status_code for r in results)==[200,409]
    winner_headers=a if results[0].status_code==200 else b
    loser_headers=b if winner_headers==a else a
    winner=next(r for r in results if r.status_code==200).json()
    assert post(client,report,winner_headers,payload).json()==winner
    assert post(client,report,loser_headers,payload).status_code==409
    assert post(client,report,loser_headers,body(read(client,report,loser_headers))).status_code==200
    assert read(client,report,winner_headers)["review_state"]["reviewer_count"]==2
    assert post(client,report,winner_headers,payload).json()==winner
    with client.app.state.sessions() as session:
        assert all("result" not in e for e in session.get(ReviewCase,report["id"]).events)


def test_revoke_and_rotate_require_current_key_and_keep_old_reviews(client):
    report=attempt(client);headers=actor(client,"alice")
    post(client,report,headers,body(read(client,report,headers)))
    with client.app.state.sessions() as session,session.begin():session.get(ReviewActor,"alice").enabled=0
    assert client.get("/api/v1/reviewing/me",headers=headers).status_code==401
    with client.app.state.sessions() as session,session.begin():
        row=session.get(ReviewActor,"alice");row.enabled=1;row.token_hash=hashlib.sha256(b"replacement-fixture-key").hexdigest()
    assert client.get("/api/v1/reviewing/me",headers=headers).status_code==401
    new={"Authorization":"Bearer replacement-fixture-key"}
    assert read(client,report,new)["own_latest"]["actor"]=="alice"
    assert client.get("/api/v1/verification").json()["reports"][-1]["review_state"]["reviewer_count"]==1


def test_local_access_cli_writes_key_only_to_ignored_file_and_revokes(client,monkeypatch,tmp_path,capsys):
    from app import review_access
    monkeypatch.setattr(review_access,"ROOT",tmp_path)
    monkeypatch.setattr(review_access,"engine_for",lambda:client.app.state.engine)
    monkeypatch.setattr("sys.argv",["review-access","create","alice","测试复核者"])
    review_access.main()
    key=(tmp_path/".runtime/reviewer-keys/alice.txt").read_text().strip()
    assert len(key)>=40 and key not in capsys.readouterr().out
    assert client.get("/api/v1/reviewing/me",headers={"Authorization":"Bearer "+key}).status_code==200
    monkeypatch.setattr("sys.argv",["review-access","rotate","alice"]);review_access.main()
    new_key=(tmp_path/".runtime/reviewer-keys/alice.txt").read_text().strip()
    assert key!=new_key and new_key not in capsys.readouterr().out
    assert client.get("/api/v1/reviewing/me",headers={"Authorization":"Bearer "+key}).status_code==401
    monkeypatch.setattr("sys.argv",["review-access","revoke","alice"]);review_access.main()
    assert client.get("/api/v1/reviewing/me",headers={"Authorization":"Bearer "+new_key}).status_code==401


@pytest.mark.parametrize("identity",["local-demo","../escape","ab"])
def test_access_cli_rejects_learner_and_unsafe_identity(identity,monkeypatch):
    from app import review_access
    monkeypatch.setattr("sys.argv",["review-access","create",identity,"测试"])
    with pytest.raises(SystemExit):review_access.main()
