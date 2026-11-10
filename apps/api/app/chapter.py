"""A bounded exploration chapter; discovery never updates mastery evidence."""
from .learner_context import learner_id

import hashlib
import json
import math

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from .models import AdventureSession, ContentRelease, now

router = APIRouter(prefix="/api/v1/chapter")
KEYS = [(1, 0), (0, 1), (1, 1)]
CHAIN = ["match", "mask", "normalize", "mix"]


def attention(query, mask=False, future=10):
    scores = [(query[0] * x + query[1] * y) / math.sqrt(2) for x, y in KEYS]
    all_weights, outputs = [], []
    for position in range(3):
        allowed = scores[:position + 1] if mask else scores
        values = [math.exp(score - max(allowed)) for score in allowed]
        weights = [value / sum(values) for value in values] + [0.0] * (3 - len(allowed))
        all_weights.append(weights)
        outputs.append(sum(w*v for w, v in zip(weights, [2, 6, future])))
    return {"weights": all_weights, "outputs": outputs}


def session_id(node,owner="local-demo"):
    return owner if node == "mask" else owner + ":" + node


def chapter_state(session, release_id):
    release = session.get(ContentRelease, release_id)
    config = release.manifest["chapter"]
    rows = {node["id"]: session.get(AdventureSession, session_id(node["id"],learner_id(session))) for node in config["nodes"]}
    nodes = []
    for node in config["nodes"]:
        row = rows[node["id"]]
        unlocked = all(rows[previous].stage == 3 for previous in node["requires"])
        nodes.append({**node, "title": node["title"] if unlocked else "迷雾", "entity_ids": node["entity_ids"] if row.stage == 3 else [],
                      "unlocked": unlocked, "stage": row.stage, "revision": row.revision,
                      "status": "completed" if row.stage == 3 else "available" if unlocked else "locked",
                      "release_id": row.release_id,
                      "trail": [{"stage": e["stage"], "created_at": e["created_at"], "hint_used": e["hint_used"]} for e in row.events]})
    main_completed = sum(rows[node].stage == 3 for node in config["main_path"])
    next_node = next((node for node in config["main_path"] if rows[node].stage < 3), "beacon")
    return {"id": config["id"], "version": config["version"], "title": config["title"], "release_id": release_id,
            "nodes": nodes, "main_completed": main_completed, "main_total": len(config["main_path"]),
            "completed": main_completed == len(config["main_path"]), "all_explored": all(row.stage == 3 for row in rows.values()),
            "next_node": next_node, "mastery": "unverified"}


class ChapterMove(BaseModel):
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8, max_length=120)
    stage: int = Field(ge=0, le=2)
    queries: list[list[float]] = Field(min_length=1, max_length=2)
    observed: list[list[float]] = Field(min_length=1, max_length=2)
    mask: bool = False
    future_value: float = Field(default=10, ge=0, le=40, allow_inf_nan=False)
    reason: str | None = Field(default=None, max_length=40)
    chain: list[str] = Field(default_factory=list, max_length=4)
    hint_used: bool = False

    @model_validator(mode="after")
    def bounded(self):
        if any(len(q) != 2 or any(not math.isfinite(v) or not -2 <= v <= 2 for v in q) for q in self.queries):
            raise ValueError("Each query needs two finite coordinates in [-2,2]")
        if any(len(out) != 3 or any(not math.isfinite(v) for v in out) for out in self.observed):
            raise ValueError("Each head needs three finite outputs")
        return self


@router.get("")
def current_chapter(request: Request):
    with request.app.state.sessions() as session:
        return chapter_state(session, request.app.state.release_id)


@router.post("/{node}/moves")
def chapter_move(node: str, body: ChapterMove, request: Request):
    if node not in {"query", "heads", "beacon"}:
        raise HTTPException(404, "Unknown chapter island")
    with request.app.state.sessions() as session:
        # Chapter moves share one lock order, preventing duplicate or stale advancement.
        session.scalar(select(AdventureSession).where(AdventureSession.id == session_id("mask",learner_id(session))).with_for_update())
        row = session.scalar(select(AdventureSession).where(AdventureSession.id == session_id(node,learner_id(session))).with_for_update())
        config = session.get(ContentRelease, request.app.state.release_id).manifest["chapter"]
        definition = next(item for item in config["nodes"] if item["id"] == node)
        if any(session.get(AdventureSession, session_id(previous,learner_id(session))).stage != 3 for previous in definition["requires"]):
            raise HTTPException(403, "这条航路还没有接通，先探索相邻的光点。")
        digest = hashlib.sha256(json.dumps(body.model_dump(), sort_keys=True).encode()).hexdigest()
        prior = next((e for e in row.events if e["operation_key"] == body.operation_key), None)
        if prior:
            if prior["request_hash"] != digest:
                raise HTTPException(409, "同一操作不能提交不同机关条件。")
            return prior["result"]
        if body.stage != row.stage or body.base_revision != row.revision:
            raise HTTPException(409, "航迹已更新，请返回航图重新进入；当前机关配置仍保留。")
        expected_heads = 2 if node == "heads" else 1
        if len(body.queries) != expected_heads or len(body.observed) != expected_heads:
            raise HTTPException(422, "Incorrect head count")
        if node != "beacon" and (body.mask or body.future_value != 10):
            raise HTTPException(422, "This island keeps all keys visible and values fixed")
        results = [attention(q, body.mask, body.future_value) for q in body.queries]
        if any(abs(a-b) > 1e-6 for head, expected in zip(body.observed, results) for a, b in zip(head, expected["outputs"])):
            raise HTTPException(422, "灯塔读数与查询、光闸不一致。")
        result = results[0]
        if node == "query":
            weights = result["weights"][-1]
            valid = ((body.stage == 0 and weights[1] > max(weights[0], weights[2]) + .05)
                     or (body.stage == 1 and result["outputs"][-1] > 8)
                     or (body.stage == 2 and result["outputs"][-1] < 4 and body.reason == "match"))
        elif node == "heads":
            a, b = [head["outputs"][-1] for head in results]
            valid = a < 4 and (body.stage == 0 or b > 8) and (body.stage < 2 or body.reason == "concat")
        else:
            baseline = attention(body.queries[0], body.mask, 10)["outputs"]
            valid = body.mask and result["outputs"][-1] > (8 if body.stage == 0 else 20)
            if body.stage > 0:
                valid = valid and body.future_value >= 30 and all(abs(a-b) < 1e-6 for a, b in zip(result["outputs"][:2], baseline[:2]))
            if body.stage == 2:
                valid = valid and body.chain == CHAIN
        if not valid:
            raise HTTPException(422, "还差一点：检查当前目标、光路或关系卡。")
        row.stage += 1
        row.revision += 1
        event = {**body.model_dump(), "request_hash": digest, "created_at": now().isoformat(), "rule_version": "information-sea-v1"}
        row.events = [*row.events, event]
        result = chapter_state(session, request.app.state.release_id)
        row.events = [*row.events[:-1], {**event, "result": result}]
        session.commit()
        return result
