import copy
from uuid import uuid4

from sqlalchemy import select

from app.models import AdventureSession
from test_learning_loop import client, reach_query


def test_read_does_not_reveal_locked_entities_or_mutate_graph(client):
    before = client.get("/api/v1/learner-graph").json()
    discoveries = client.get("/api/v1/discoveries").json()
    assert discoveries["entities"] == discoveries["relations"] == discoveries["chapters"] == []
    assert discoveries["mastery"] == "unverified"
    assert client.get("/api/v1/learner-graph").json() == before


def test_completed_discoveries_have_actual_origin_and_no_unfinished_node(client):
    reach_query(client)
    state = client.get("/api/v1/discoveries").json()
    ids = {entity["id"] for entity in state["entities"]}
    assert ids == {"entity-0068", "entity-0142", "entity-0147"}
    assert [chapter["id"] for chapter in state["chapters"]] == ["information-sea"]
    mask = next(entity for entity in state["entities"] if entity["id"] == "entity-0068")
    assert mask["origins"][0]["node_id"] == "mask" and mask["origins"][0]["completed_at"]
    assert all(relation["source"] in ids and relation["target"] in ids for relation in state["relations"])
    before = client.get("/api/v1/learner-graph").json()
    assert client.get("/api/v1/discoveries").json() == state
    assert client.get("/api/v1/learner-graph").json() == before


def test_duplicate_concept_has_two_origins_and_relations_remain_drafts(client):
    with client.app.state.sessions() as session:
        for row in session.scalars(select(AdventureSession)).all():
            row.stage = 3
        session.commit()
    state = client.get("/api/v1/discoveries").json()
    mask = next(entity for entity in state["entities"] if entity["id"] == "entity-0068")
    assert {origin["node_id"] for origin in mask["origins"]} == {"mask", "beacon"}
    assert len(state["entities"]) == len({entity["id"] for entity in state["entities"]})
    assert len(state["chapters"]) == 9 and state["relations"]
    assert all(relation["review_status"] == "proposed" for relation in state["relations"])
    assert state["status"] == "draft" and state["mastery"] == "unverified"


def test_personal_explanations_relation_notes_and_origins_round_trip_without_destroying_old_snapshot(client):
    initial = client.get("/api/v1/learner-graph").json()
    payload = copy.deepcopy(initial["payload"])
    payload["nodes"][0]["data"]["note"] = "这是我自己写的理解。"
    payload["nodes"][0]["data"]["discovery_origins"] = [{"node_id":"token", "release_id":initial["release_id"]}]
    payload["edges"][0].update(note="我的理由\n仅在这些条件下成立。", reference_id="relation-0018", reference_release=initial["release_id"])
    body = {"base_revision":initial["revision"], "operation_key":str(uuid4()), "payload":payload, "note":"修订星图解释与条件"}
    response = client.post("/api/v1/learner-graph/operations", json=body)
    assert response.status_code == 200
    saved = response.json()
    assert saved["payload"]["nodes"][0]["data"]["note"] == "这是我自己写的理解。"
    assert saved["payload"]["nodes"][1]["data"]["note"] == initial["payload"]["nodes"][1]["data"]["note"]
    assert saved["payload"]["edges"][0]["note"] == payload["edges"][0]["note"]
    assert saved["payload"]["nodes"][0]["data"]["discovery_origins"] == payload["nodes"][0]["data"]["discovery_origins"]
    assert client.post("/api/v1/learner-graph/operations", json=body).json() == saved
    assert client.get(f"/api/v1/learner-graph/versions/{initial['revision']}").json() == initial
    restored = client.post("/api/v1/learner-graph/restore", json={"base_revision":saved["revision"], "operation_key":str(uuid4()), "revision":initial["revision"]}).json()
    assert restored["revision"] > saved["revision"] and restored["payload"] == initial["payload"]
    assert client.get(f"/api/v1/learner-graph/versions/{saved['revision']}").json() == saved


def test_relation_explanations_are_bounded_and_not_an_automatic_mastery_claim(client):
    initial = client.get("/api/v1/learner-graph").json()
    payload = copy.deepcopy(initial["payload"])
    payload["edges"][0]["note"] = "a"*3001
    response = client.post("/api/v1/learner-graph/operations", json={"base_revision":initial["revision"], "operation_key":str(uuid4()), "payload":payload, "note":"过长解释"})
    assert response.status_code == 422
    assert client.get("/api/v1/discoveries").json()["mastery"] == "unverified"
