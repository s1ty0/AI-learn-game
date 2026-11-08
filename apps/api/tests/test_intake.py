from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor

from test_learning_loop import client
from app.intake_tasks import task_at


def act(client, state, action="answer", choice=None, **extra):
    return client.post("/api/v1/intake/actions", json={"base_revision":state["revision"], "operation_key":str(uuid4()),
        "action":action,"task_id":state["task"]["id"] if state["task"] else None,"choice":choice,**extra})


def test_read_is_private_and_does_not_mutate_other_records(client):
    before=client.get("/api/v1/learner-graph").json()
    state=client.get("/api/v1/intake").json()
    assert state["answered"] == 0 and all(d["tested"] == 0 for d in state["domains"])
    assert "correct" not in state["task"] and "explanation" not in state["task"] and state["task"]["hint"] is None
    act(client,state,"finish")
    assert client.get("/api/v1/learner-graph").json() == before
    assert client.get("/api/v1/expedition").json()["completed"] is False


def test_unknown_and_hint_select_bridge_and_never_mastery(client):
    state=client.get("/api/v1/intake").json()
    state=act(client,state,"hint").json()
    assert state["task"]["hint"] and state["answered"] == 0
    state=act(client,state,choice=0,explanation="先看每行").json()
    assert state["domains"][0]["evidence"][0]["outcome"] == "supported_choice"
    assert state["task"]["id"] == "entry-0-1"
    state=act(client,state).json()
    assert state["domains"][0]["evidence"][1]["outcome"] == "unknown"
    assert state["mastery"] == "unverified"
    state=act(client,state,"finish").json()
    assert state["finished"] and state["task"] is None and state["answered"] == 2
    assert all(d["tested"] == 0 for d in state["domains"][1:])


def test_ten_independent_probes_complete_with_deeper_branches_and_versioned_evidence(client):
    state=client.get("/api/v1/intake").json();answers=[]
    for index in range(10):
        task=task_at(answers)
        assert state["task"]["id"] == task["id"]
        state=act(client,state,choice=task["correct"]).json()
        answers.append({"outcome":"independent_choice"})
    assert state["finished"] and state["answered"] == 10
    assert state["recommendation"]["chapter"] == "information-sea"
    assert all(d["tested"] == 2 for d in state["domains"])
    assert all(e["task_version"] == state["version"] for d in state["domains"] for e in d["evidence"])
    assert act(client,state,"finish").status_code == 409


def test_math_strength_and_program_bridge_do_not_become_code_proof(client):
    state=client.get("/api/v1/intake").json();answers=[]
    for index in range(6):
        task=task_at(answers);choice=task["correct"] if index < 4 else None
        state=act(client,state,choice=choice).json()
        answers.append({"outcome":"independent_choice" if index<4 else "unknown"})
    state=act(client,state,"finish").json()
    assert state["recommendation"]["chapter"] == "learning"
    assert state["domains"][2]["evidence"][1]["kind"] == "操作直觉"


def test_retry_and_two_writers_only_record_once(client):
    state=client.get("/api/v1/intake").json()
    body={"base_revision":0,"operation_key":str(uuid4()),"action":"answer","task_id":state["task"]["id"],"choice":0}
    first=client.post("/api/v1/intake/actions",json=body)
    assert first.status_code == 200 and client.post("/api/v1/intake/actions",json=body).json() == first.json()
    assert client.post("/api/v1/intake/actions",json={**body,"choice":1}).status_code == 409
    assert client.post("/api/v1/intake/actions",json={**body,"operation_key":str(uuid4())}).status_code == 409
    assert client.get("/api/v1/intake").json()["answered"] == 1


def test_bad_order_and_input_rejected_without_progress(client):
    state=client.get("/api/v1/intake").json()
    assert act(client,state,task_id="entry-4-2").status_code == 422
    assert act(client,state,choice=3).status_code == 422
    assert act(client,state,explanation="x"*1501).status_code == 422
    assert client.get("/api/v1/intake").json() == state


def test_concurrent_first_actions_serialize_creation(client):
    state=client.get("/api/v1/intake").json()
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:act(client,state,choice=0).status_code,range(2)))
    assert sorted(results) == [200,409]
    assert client.get("/api/v1/intake").json()["answered"] == 1
