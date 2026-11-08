import copy
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.db import Base
from app.main import create_app


@pytest.fixture
def client():
    url = os.environ["DATABASE_URL"]
    schema = "test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    Base.metadata.create_all(engine)
    try:
        with TestClient(create_app(engine)) as current:
            yield current
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def mutation(client, note="我的解释", key=None):
    snapshot = client.get("/api/v1/learner-graph").json()
    payload = copy.deepcopy(snapshot["payload"])
    payload["nodes"][0]["data"]["note"] = note
    return {"base_revision": snapshot["revision"], "operation_key": key or str(uuid4()), "payload": payload, "note": note}


def test_catalog_import_and_private_answers_not_exposed(client):
    response = client.get("/api/v1/content")
    assert response.status_code == 200
    data = response.json()
    assert len(data["entities"]) >= 160
    assert "required_points" not in response.text
    assert "rubric" not in response.text
    assert data["status"] == "draft"


def test_save_refresh_and_restore_creates_new_revision(client):
    initial = client.get("/api/v1/learner-graph").json()
    saved = client.post("/api/v1/learner-graph/operations", json=mutation(client)).json()
    assert saved["revision"] == 1
    assert client.get("/api/v1/learner-graph").json()["payload"]["nodes"][0]["data"]["note"] == "我的解释"
    restored = client.post("/api/v1/learner-graph/restore", json={"base_revision": 1, "operation_key": str(uuid4()), "revision": 0}).json()
    assert restored["revision"] == 2
    assert restored["restored_from"] == 0
    assert restored["payload"] == initial["payload"]
    assert client.get("/api/v1/learner-graph/versions/1").json()["payload"] == saved["payload"]
    assert len(client.get("/api/v1/learner-graph/versions").json()) == 3


def test_lesson_uses_imported_release_and_blocks_arbitrary_files(client, monkeypatch):
    original = client.get("/api/v1/lesson").json()
    def no_live_file_read(*args, **kwargs):
        raise AssertionError("Published lesson must come from its pinned content release")
    monkeypatch.setattr(Path, "read_text", no_live_file_read)
    assert client.get("/api/v1/lesson").json() == original
    assert client.get("/api/v1/lesson", params={"module": "../../data/assessments/transformer-challenges.json"}).status_code == 404
    assert client.get("/api/v1/lesson", params={"module": "training-and-generation.md"}).status_code == 200


def test_idempotency_returns_same_version_but_rejects_key_reuse(client):
    body = mutation(client)
    first = client.post("/api/v1/learner-graph/operations", json=body)
    retry = client.post("/api/v1/learner-graph/operations", json=body)
    assert first.status_code == retry.status_code == 200
    assert first.json() == retry.json()
    body["note"] = "不同内容"
    assert client.post("/api/v1/learner-graph/operations", json=body).status_code == 409
    assert len(client.get("/api/v1/learner-graph/versions").json()) == 2


def test_stale_revision_does_not_overwrite(client):
    a, b = mutation(client, "标签页一"), mutation(client, "标签页二")
    assert client.post("/api/v1/learner-graph/operations", json=a).status_code == 200
    conflict = client.post("/api/v1/learner-graph/operations", json=b)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["current_revision"] == 1
    assert client.get("/api/v1/learner-graph").json()["note"] == "标签页一"


def test_concurrent_updates_have_only_one_winner(client):
    a, b = mutation(client, "并发一"), mutation(client, "并发二")
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda body: client.post("/api/v1/learner-graph/operations", json=body).status_code, [a, b]))
    assert sorted(responses) == [200, 409]
    assert client.get("/api/v1/learner-graph").json()["revision"] == 1


def test_invalid_graph_cannot_enter_history(client):
    body = mutation(client)
    body["payload"]["edges"][0]["target"] = "does-not-exist"
    assert client.post("/api/v1/learner-graph/operations", json=body).status_code == 422
    assert client.get("/api/v1/learner-graph").json()["revision"] == 0


def attempt_body():
    return {"operation_key": str(uuid4()), "prediction": "same", "explanation": "前两个位置读不到第三个位置，所以修改未来值不会影响它们。",
            "hint_used": False, "mask_enabled": True, "future_value": 30, "observed": [2, 5, 80 / 6]}


def test_attempt_records_evidence_without_auto_mastery(client):
    body = attempt_body()
    response = client.post("/api/v1/attempts", json=body)
    assert response.status_code == 200
    assert response.json()["status"] == "needs_review"
    assert response.json()["prediction_correct"] is True
    assert response.json()["content_release"] == client.get("/api/v1/content").json()["release_id"]
    assert response.json()["rule_version"] == "causal-mask-numeric-v1"
    assert client.post("/api/v1/attempts", json=body).json()["id"] == response.json()["id"]
    assert len(client.get("/api/v1/attempts").json()) == 1


def test_fabricated_numeric_evidence_rejected(client):
    body = attempt_body()
    body["observed"] = [999, 999, 999]
    assert client.post("/api/v1/attempts", json=body).status_code == 422
    assert client.get("/api/v1/attempts").json() == []


def adventure_body(stage, revision=None, **kwargs):
    return {"operation_key": str(uuid4()), "base_revision": stage if revision is None else revision,
            "stage": stage, "mask_enabled": stage != 1, "future_value": 30,
            "reason": "blocked" if stage == 2 else None, **kwargs}


def test_adventure_rejects_skipping_and_unsolved_mechanisms(client):
    assert client.get("/api/v1/adventure").json()["discovered"] == []
    assert client.post("/api/v1/adventure/moves", json=adventure_body(2, revision=0)).status_code == 409
    assert client.post("/api/v1/adventure/moves", json=adventure_body(0, future_value=10)).status_code == 422
    assert client.get("/api/v1/adventure").json()["stage"] == 0


def test_adventure_progress_is_durable_and_does_not_claim_mastery(client):
    graph = client.get("/api/v1/learner-graph").json()
    first_body = adventure_body(0, hint_used=True)
    first = client.post("/api/v1/adventure/moves", json=first_body)
    assert first.status_code == 200
    assert client.post("/api/v1/adventure/moves", json=first_body).json() == first.json()
    changed = {**first_body, "future_value": 35}
    assert client.post("/api/v1/adventure/moves", json=changed).status_code == 409
    assert client.get("/api/v1/adventure").json()["stage"] == 1
    assert client.post("/api/v1/adventure/moves", json=adventure_body(1)).status_code == 200
    assert client.post("/api/v1/adventure/moves", json=adventure_body(2, reason="distance")).status_code == 422
    assert client.post("/api/v1/adventure/moves", json=adventure_body(2, future_value=20)).status_code == 422
    assert client.post("/api/v1/adventure/moves", json=adventure_body(2)).status_code == 200
    final = client.get("/api/v1/adventure").json()
    assert final["stage"] == final["revision"] == 3
    assert final["discovered"] == ["entity-0068"]
    assert final["mastery"] == "unverified"
    assert len(final["trail"]) == 3
    assert final["trail"][0]["hint_used"] is True
    assert client.get("/api/v1/learner-graph").json() == graph


def test_concurrent_adventure_moves_do_not_double_unlock(client):
    bodies = [adventure_body(0), adventure_body(0)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda body: client.post("/api/v1/adventure/moves", json=body).status_code, bodies))
    assert sorted(codes) == [200, 409]
    assert len(client.get("/api/v1/adventure").json()["trail"]) == 1


def unlock_prism(client):
    for stage in range(3):
        assert client.post("/api/v1/adventure/moves", json=adventure_body(stage)).status_code == 200


def prism_body(stage, scores, **overrides):
    import math
    exp = [math.exp(score - max(scores)) for score in scores]
    weights = [value / sum(exp) for value in exp]
    return {"operation_key": str(uuid4()), "base_revision": stage, "stage": stage, "scores": scores,
            "weights": weights, "output": sum(w*v for w, v in zip(weights, [2, 6, 10])),
            "reason": "relative" if stage == 2 else None, "hint_used": False, **overrides}


def test_prism_requires_discovery_and_preserves_mask_history(client):
    assert client.get("/api/v1/adventure/prism").json()["unlocked"] is False
    assert client.post("/api/v1/adventure/prism/moves", json=prism_body(0, [0, 0, 0])).status_code == 403
    unlock_prism(client)
    prior = client.get("/api/v1/adventure").json()
    assert client.get("/api/v1/adventure/prism").json()["unlocked"] is True
    for stage, scores in enumerate([[1, 1, 1], [0, 0, 3], [3, 0, 0]]):
        assert client.post("/api/v1/adventure/prism/moves", json=prism_body(stage, scores)).status_code == 200
    final = client.get("/api/v1/adventure/prism").json()
    assert final["stage"] == 3
    assert final["discovered"] == ["entity-0142", "entity-0147"]
    assert final["mastery"] == "unverified"
    assert len(final["trail"]) == 3
    assert client.get("/api/v1/adventure").json() == prior


def test_prism_rejects_fabricated_weights_and_incomplete_conditions(client):
    unlock_prism(client)
    assert client.post("/api/v1/adventure/prism/moves", json=prism_body(0, [0, 2, 0])).status_code == 422
    assert client.post("/api/v1/adventure/prism/moves", json=prism_body(0, [0, 0, 0], output=999)).status_code == 422
    assert client.post("/api/v1/adventure/prism/moves", json=prism_body(0, [0, 0, 0], weights=[1, 0, 0])).status_code == 422
    assert client.post("/api/v1/adventure/prism/moves", json=prism_body(2, [4, 0, 0], base_revision=0)).status_code == 409
    assert client.get("/api/v1/adventure/prism").json()["stage"] == 0


def test_prism_retry_conflicts_and_bad_reason(client):
    unlock_prism(client)
    body = prism_body(0, [0, 0, 0])
    first = client.post("/api/v1/adventure/prism/moves", json=body).json()
    assert client.post("/api/v1/adventure/prism/moves", json=body).json() == first
    assert client.post("/api/v1/adventure/prism/moves", json={**body, "hint_used": True}).status_code == 409
    assert client.post("/api/v1/adventure/prism/moves", json=prism_body(1, [0, 0, 0])).status_code == 422
    assert client.post("/api/v1/adventure/prism/moves", json=prism_body(1, [0, 0, 3])).status_code == 200
    assert client.post("/api/v1/adventure/prism/moves", json=prism_body(2, [3, 0, 0], reason="winner")).status_code == 422
    assert client.get("/api/v1/adventure/prism").json()["stage"] == 2


def test_prism_concurrent_steps_only_advance_once(client):
    unlock_prism(client)
    bodies = [prism_body(0, [0, 0, 0]), prism_body(0, [0, 0, 0])]
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda body: client.post("/api/v1/adventure/prism/moves", json=body).status_code, bodies))
    assert sorted(codes) == [200, 409]
    assert len(client.get("/api/v1/adventure/prism").json()["trail"]) == 1


def chapter_body(stage, queries, *, mask=False, future=10, reason=None, chain=None, **overrides):
    import math
    observed = []
    for x, y in queries:
        scores = [x / math.sqrt(2), y / math.sqrt(2), (x+y) / math.sqrt(2)]
        head = []
        for position in range(3):
            limit = position + 1 if mask else 3
            weights = [math.exp(value) for value in scores[:limit]]
            head.append(sum(w*v for w, v in zip(weights, [2, 6, future])) / sum(weights))
        observed.append(head)
    return {"operation_key": str(uuid4()), "base_revision": stage, "stage": stage, "queries": queries,
            "observed": observed, "mask": mask, "future_value": future, "reason": reason, "chain": chain or [], **overrides}


def reach_query(client):
    unlock_prism(client)
    for stage, scores in enumerate([[0, 0, 0], [0, 0, 3], [3, 0, 0]]):
        assert client.post("/api/v1/adventure/prism/moves", json=prism_body(stage, scores)).status_code == 200


def complete_query(client):
    for stage, query in enumerate([[-1, 1], [2, 2], [2, -2]]):
        response = client.post("/api/v1/chapter/query/moves", json=chapter_body(stage, [query], reason="match" if stage == 2 else None))
        assert response.status_code == 200, response.text


def test_chapter_starts_small_and_requires_the_connected_path(client):
    state = client.get("/api/v1/chapter").json()
    assert state["main_completed"] == 0
    assert state["next_node"] == "mask"
    assert [node["id"] for node in state["nodes"] if node["unlocked"]] == ["mask"]
    assert all(node["title"] == "迷雾" for node in state["nodes"] if not node["unlocked"])
    assert client.post("/api/v1/chapter/query/moves", json=chapter_body(0, [[-1, 1]])).status_code == 403
    assert client.post("/api/v1/chapter/beacon/moves", json=chapter_body(0, [[2, 2]], mask=True)).status_code == 403


def test_chapter_main_path_has_an_end_without_requiring_optional_branch(client):
    original_graph = client.get("/api/v1/learner-graph").json()
    reach_query(client)
    old_mask = client.get("/api/v1/adventure").json()
    old_prism = client.get("/api/v1/adventure/prism").json()
    complete_query(client)
    state = client.get("/api/v1/chapter").json()
    assert state["main_completed"] == 3 and state["completed"] is False
    assert {node["id"] for node in state["nodes"] if node["status"] == "available"} == {"heads", "beacon"}
    for stage in range(3):
        body = chapter_body(stage, [[2, 2]], mask=True, future=10 if stage == 0 else 30,
                            chain=["match", "mask", "normalize", "mix"] if stage == 2 else [])
        response = client.post("/api/v1/chapter/beacon/moves", json=body)
        assert response.status_code == 200, response.text
    final = client.get("/api/v1/chapter").json()
    assert final["completed"] is True and final["all_explored"] is False
    assert final["mastery"] == "unverified"
    assert final["main_completed"] == final["main_total"] == 4
    assert client.get("/api/v1/adventure").json() == old_mask
    assert client.get("/api/v1/adventure/prism").json() == old_prism
    assert client.get("/api/v1/learner-graph").json() == original_graph
    for stage in range(3):
        body = chapter_body(stage, [[2, -2], [0, 0] if stage == 0 else [2, 2]], reason="concat" if stage == 2 else None)
        assert client.post("/api/v1/chapter/heads/moves", json=body).status_code == 200
    assert client.get("/api/v1/chapter").json()["all_explored"] is True


def test_chapter_query_rejects_wrong_targets_forged_outputs_and_stale_retry(client):
    reach_query(client)
    assert client.post("/api/v1/chapter/query/moves", json=chapter_body(0, [[2, 2]])).status_code == 422
    assert client.post("/api/v1/chapter/query/moves", json=chapter_body(0, [[-1, 1]], observed=[[0, 0, 0]])).status_code == 422
    body = chapter_body(0, [[-1, 1]])
    first = client.post("/api/v1/chapter/query/moves", json=body).json()
    assert client.post("/api/v1/chapter/query/moves", json=body).json() == first
    assert client.post("/api/v1/chapter/query/moves", json={**body, "hint_used": True}).status_code == 409
    assert client.post("/api/v1/chapter/query/moves", json=chapter_body(0, [[-1, 1]])).status_code == 409
    assert client.post("/api/v1/chapter/query/moves", json=chapter_body(2, [[2, -2]])).status_code == 409


def test_chapter_branch_keeps_both_heads_and_correct_combination(client):
    reach_query(client)
    complete_query(client)
    assert client.post("/api/v1/chapter/heads/moves", json=chapter_body(0, [[2, -2]])).status_code == 422
    assert client.post("/api/v1/chapter/heads/moves", json=chapter_body(0, [[2, -2], [0, 0]])).status_code == 200
    assert client.post("/api/v1/chapter/heads/moves", json=chapter_body(1, [[2, -2], [2, -2]])).status_code == 422
    assert client.post("/api/v1/chapter/heads/moves", json=chapter_body(1, [[2, -2], [2, 2]])).status_code == 200
    assert client.post("/api/v1/chapter/heads/moves", json=chapter_body(2, [[2, -2], [2, 2]], reason="average")).status_code == 422
    assert client.post("/api/v1/chapter/heads/moves", json=chapter_body(2, [[2, -2], [2, 2]], reason="concat")).status_code == 200
    node = next(node for node in client.get("/api/v1/chapter").json()["nodes"] if node["id"] == "heads")
    assert node["stage"] == 3 and node["entity_ids"] == ["entity-0064"]


def test_chapter_finale_requires_causal_mask_and_mechanism_order(client):
    reach_query(client)
    complete_query(client)
    assert client.post("/api/v1/chapter/beacon/moves", json=chapter_body(0, [[2, 2]])).status_code == 422
    assert client.post("/api/v1/chapter/beacon/moves", json=chapter_body(0, [[2, 2]], mask=True)).status_code == 200
    assert client.post("/api/v1/chapter/beacon/moves", json=chapter_body(1, [[2, 2]], mask=True, future=10)).status_code == 422
    assert client.post("/api/v1/chapter/beacon/moves", json=chapter_body(1, [[2, 2]], mask=True, future=30)).status_code == 200
    wrong = chapter_body(2, [[2, 2]], mask=True, future=30, chain=["match", "normalize", "mask", "mix"])
    assert client.post("/api/v1/chapter/beacon/moves", json=wrong).status_code == 422
    assert client.get("/api/v1/chapter").json()["completed"] is False


def test_chapter_concurrent_moves_have_only_one_advance(client):
    reach_query(client)
    bodies = [chapter_body(0, [[-1, 1]]), chapter_body(0, [[-1, 1]])]
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda body: client.post("/api/v1/chapter/query/moves", json=body).status_code, bodies))
    assert sorted(codes) == [200, 409]
    node = next(node for node in client.get("/api/v1/chapter").json()["nodes"] if node["id"] == "query")
    assert node["stage"] == 1 and len(node["trail"]) == 1
