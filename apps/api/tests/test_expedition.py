import copy
import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.content import DEMO_GRAPH
from app.expedition import LabState, mechanics, NEW_IDS
from app.models import AdventureSession
from test_learning_loop import client, reach_query, complete_query, chapter_body

ROOT = Path(__file__).resolve().parents[3]
SOLUTIONS = json.loads((ROOT / "data/games/expedition-fixtures.json").read_text(encoding="utf-8"))


def body(node, stage, **changes):
    state = LabState(**SOLUTIONS[node][stage])
    observed, _ = mechanics(node, stage, state)
    return {"base_revision": stage, "operation_key": str(uuid4()), "stage": stage,
            "state": state.model_dump(), "observed": observed, **changes}


def open_for_test(client, node):
    config = client.app.state.sessions
    with config() as session:
        for row in session.scalars(select(AdventureSession)).all():
            row.stage = 0 if row.id == DEMO_GRAPH + ":" + node else 3
        session.commit()


@pytest.mark.parametrize("node", sorted(NEW_IDS))
def test_each_island_has_three_valid_recomputed_steps_and_durable_discovery(client, node):
    open_for_test(client, node)
    for stage in range(3):
        request = body(node, stage)
        if stage == 0:
            forged = copy.deepcopy(request); forged["observed"][0] += 999
            assert client.post(f"/api/v1/expedition/{node}/moves", json=forged).status_code == 422
        if stage == 2 and node != "token" or stage == 1 and node == "token":
            wrong_reason = copy.deepcopy(request); wrong_reason["state"]["reason"] = "wrong-connection"
            assert client.post(f"/api/v1/expedition/{node}/moves", json=wrong_reason).status_code == 422
        response = client.post(f"/api/v1/expedition/{node}/moves", json=request)
        assert response.status_code == 200, response.text
        if stage == 0:
            assert client.post(f"/api/v1/expedition/{node}/moves", json=request).json() == response.json()
            wrong_key = copy.deepcopy(request); wrong_key["hint_used"] = True
            assert client.post(f"/api/v1/expedition/{node}/moves", json=wrong_key).status_code == 409
    saved = client.get("/api/v1/expedition").json()
    row = next(item for item in saved["nodes"] if item["id"] == node)
    assert row["stage"] == row["revision"] == 3 and row["discovery"] and len(row["trail"]) == 3
    assert saved["mastery"] == "unverified"


def test_new_chapters_remain_locked_before_first_main_path_and_reject_unknown_state(client):
    state = client.get("/api/v1/expedition").json()
    assert state["unlocked"] is False
    assert all(not chapter["unlocked"] for chapter in state["chapters"])
    assert all(node["title"] == "迷雾" and not node["steps"] for node in state["nodes"])
    assert client.post("/api/v1/expedition/token/moves", json=body("token", 0)).status_code == 403
    assert client.get("/api/v1/expedition/lessons/generation").status_code == 403
    assert client.get("/api/v1/expedition/lessons/not-a-file").status_code == 404
    request = body("token", 0); request["state"]["untrusted_command"] = "run"
    assert client.post("/api/v1/expedition/token/moves", json=request).status_code == 422


def test_entire_connected_journey_has_more_chapters_and_optional_branches_without_rewriting_old_map(client):
    old_graph = client.get("/api/v1/learner-graph").json()
    reach_query(client); complete_query(client)
    for stage in range(3):
        response = client.post("/api/v1/chapter/beacon/moves", json=chapter_body(stage, [[2, 2]], mask=True, future=10 if stage == 0 else 30,
            chain=["match", "mask", "normalize", "mix"] if stage == 2 else []))
        assert response.status_code == 200
    first = client.get("/api/v1/chapter").json()
    assert client.get("/api/v1/expedition").json()["next_node"] == "token"
    chapters = json.loads((ROOT / "data/games/expedition.json").read_text(encoding="utf-8"))["chapters"]
    for node in [node for chapter in chapters for node in chapter["main_path"]]:
        for stage in range(3):
            response = client.post(f"/api/v1/expedition/{node}/moves", json=body(node, stage))
            assert response.status_code == 200, response.text
    final = client.get("/api/v1/expedition").json()
    assert final["completed"] is True and final["all_explored"] is False
    assert final["main_completed"] == final["main_total"] == 28
    assert (final["chapter_total"], final["node_total"], final["mechanism_total"]) == (9, 37, 111)
    assert all(chapter["completed"] for chapter in final["chapters"])
    assert all(next(node for node in final["nodes"] if node["id"] == optional)["stage"] == 0 for optional in ["ffn", "l2", "cache", "backprop", "clipping", "sampling", "swiglu", "schedule"])
    assert client.get("/api/v1/expedition/lessons/learning").status_code == 200
    lesson = client.get("/api/v1/expedition/lessons/tower")
    assert lesson.status_code == 200 and lesson.json()["status"] == "draft"
    assert "Pre-LN" in lesson.json()["markdown"] and "1e−5" in lesson.json()["markdown"]
    for chapter_id in ["optimization", "decoding", "architecture", "generalization"]:
        assert client.get(f"/api/v1/expedition/lessons/{chapter_id}").json()["status"] == "draft"
    assert client.get("/api/v1/chapter").json() == first
    assert client.get("/api/v1/learner-graph").json() == old_graph


def test_independent_math_checks_for_derivative_descent_and_cache():
    gradient = mechanics("gradient", 2, LabState(weight=2))[0]
    assert gradient == pytest.approx([0, 0, .01, .01])
    metrics = mechanics("descent", 0, LabState(rate=.1, steps=2))[0]
    ratio = 1 - 28 * .1 / 3
    assert metrics[0] == pytest.approx(2 - 2 * ratio ** 2)
    assert metrics[-1] == pytest.approx((56 / 3) * ratio ** 4)
    assert mechanics("entropy", 1, LabState(probability=.1))[0][-1] == pytest.approx(math.log(10))
    cache = mechanics("cache", 1, LabState(reuse=True))[0]
    assert cache[0] == pytest.approx(cache[1])
    assert cache[2:] == [1, 3]


def test_zero_position_signal_and_repeated_single_cache_run_cannot_pass(client):
    open_for_test(client, "position")
    request = body("position", 0); request["state"]["amount"] = 0; request["observed"] = [2, 2, 2]
    assert client.post("/api/v1/expedition/position/moves", json=request).status_code == 422
    open_for_test(client, "cache")
    request = body("cache", 0); request["state"]["modes"] = ["cached", "cached"]
    assert client.post("/api/v1/expedition/cache/moves", json=request).status_code == 422


def test_simultaneous_new_island_advancement_appends_one_step(client):
    open_for_test(client, "token")
    requests = [body("token", 0), body("token", 0)]
    with ThreadPoolExecutor(max_workers=2) as workers:
        responses = list(workers.map(lambda request: client.post("/api/v1/expedition/token/moves", json=request), requests))
    assert sorted(response.status_code for response in responses) == [200, 409]
    node = next(node for node in client.get("/api/v1/expedition").json()["nodes"] if node["id"] == "token")
    assert node["stage"] == node["revision"] == len(node["trail"]) == 1


def test_tower_normalization_and_chain_gradients_have_independent_numerical_references():
    output = mechanics("normalization", 0, LabState(inputs=[1, 2, 3], amount=0, position_enabled=True))[0]
    assert output == pytest.approx([2, 2/3, -1/math.sqrt(2/3+1e-5), 0, 1/math.sqrt(2/3+1e-5)])
    shifted = mechanics("normalization", 1, LabState(inputs=[1, 2, 3], amount=2, position_enabled=True))[0]
    assert shifted[2:] == pytest.approx(output[2:])
    assert mechanics("normalization", 2, LabState(inputs=[2, 2, 2], amount=0, position_enabled=True))[0] == [2, 0, 0, 0, 0]
    h = 1e-5
    for w in [0, .5, 1, 1.5, 2, 3]:
        gradient = mechanics("backprop", 0, LabState(weight=w))[0][4]
        difference = (((2*(w+h)-3)**2) - ((2*(w-h)-3)**2)) / (2*h)
        assert gradient == pytest.approx(difference, abs=1e-8)


def test_tower_rejects_wrong_route_factor_and_zero_shortcut(client):
    for node, changes in [("residual", {"reuse": False}), ("backprop", {"local_slope": 2}),
                           ("block", {"chain": ["attention", "norm-attention", "add-attention"]})]:
        open_for_test(client, node)
        request = body(node, 0)
        request["state"].update(changes)
        request["observed"] = mechanics(node, 0, LabState(**request["state"]))[0]
        assert client.post(f"/api/v1/expedition/{node}/moves", json=request).status_code == 422
    request = body("block", 0); request["state"]["chain"] = ["attention", "attention"]
    assert client.post("/api/v1/expedition/block/moves", json=request).status_code == 422
