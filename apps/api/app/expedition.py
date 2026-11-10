"""Versioned multi-chapter practice with bounded, independently computed mechanics."""
from .learner_context import learner_id

import hashlib
import json
import math
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from .chapter import attention, chapter_state, session_id
from .models import AdventureSession, ContentRelease, now
from .tower import BLOCK_ORDER, TOWER_IDS, tower_mechanics
from .voyage import VOYAGE_IDS, voyage_mechanics
from .frontier import FRONTIER_IDS, frontier_mechanics

router = APIRouter(prefix="/api/v1/expedition")
NEW_IDS = {"token", "embedding", "position", "ffn", "loss", "gradient", "descent", "l2", "temperature", "entropy", "generation", "cache"} | TOWER_IDS | VOYAGE_IDS | FRONTIER_IDS


class LabState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cuts: list[int] = Field(default_factory=list, max_length=6)
    rows: list[int] = Field(default_factory=list, max_length=3)
    position_enabled: bool = False
    amount: float = Field(default=1, ge=0, le=3, allow_inf_nan=False)
    inputs: list[float] = Field(default_factory=lambda: [-1, 2, 3], min_length=3, max_length=3)
    weight: float = Field(default=0, ge=-1, le=5, allow_inf_nan=False)
    probes: list[float] = Field(default_factory=list, max_length=8)
    rate: float = Field(default=.1, ge=.01, le=.3, allow_inf_nan=False)
    steps: int = Field(default=0, ge=0, le=12)
    lam: float = Field(default=0, ge=0, le=1, allow_inf_nan=False)
    temperature: float = Field(default=1, ge=.25, le=3, allow_inf_nan=False)
    probability: float = Field(default=.4, ge=.05, le=.95, allow_inf_nan=False)
    sequence: list[str] = Field(default_factory=lambda: ["A"], min_length=1, max_length=5)
    reuse: bool = False
    modes: list[str] = Field(default_factory=list, max_length=2)
    chain: list[str] = Field(default_factory=list, max_length=6)
    local_slope: float = Field(default=0, ge=-8, le=8, allow_inf_nan=False)
    momentum_beta: float = Field(default=0, ge=0, le=.9, allow_inf_nan=False)
    correct_bias: bool = False
    clip_enabled: bool = False
    max_norm: float = Field(default=1, ge=.5, le=5, allow_inf_nan=False)
    keep_count: int = Field(default=4, ge=1, le=4)
    cutoff: float = Field(default=1, ge=.05, le=1, allow_inf_nan=False)
    draws: int = Field(default=0, ge=0, le=10)
    draw_set: int = Field(default=0, ge=0, le=1)
    stop_enabled: bool = False
    token_limit: int = Field(default=4, ge=1, le=4)
    norm_kind: Literal["off", "rms", "layer"] = "off"
    feature_scale: float = Field(default=1, ge=1, le=3, allow_inf_nan=False)
    feature_shift: float = Field(default=0, ge=0, le=2, allow_inf_nan=False)
    rotation_enabled: bool = False
    query_position: int = Field(default=0, ge=0, le=6)
    key_position: int = Field(default=1, ge=0, le=6)
    kv_heads: Literal[1, 2, 4] = 4
    gate_input: float = Field(default=0, ge=-4, le=4, allow_inf_nan=False)
    branch_input: float = Field(default=2, ge=-2, le=2, allow_inf_nan=False)
    partitions: list[int] = Field(default_factory=lambda: [0]*6, min_length=6, max_length=6)
    fit_scope: Literal["train", "all"] = "all"
    held_out: float = Field(default=100, ge=100, le=200, allow_inf_nan=False)
    curvature: float = Field(default=2, ge=0, le=2, allow_inf_nan=False)
    reason: str | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def validate_lists(self):
        if len(set(self.cuts)) != len(self.cuts) or any(not 1 <= cut <= 6 for cut in self.cuts):
            raise ValueError("Invalid split boundaries")
        if any(not 0 <= row <= 2 for row in self.rows):
            raise ValueError("Unknown embedding row")
        if any(not math.isfinite(v) or not -2 <= v <= 3 for v in self.inputs):
            raise ValueError("Invalid position input")
        if any(not math.isfinite(v) or not -1 <= v <= 5 for v in self.probes):
            raise ValueError("Invalid loss probe")
        if any(value not in {"A", "B", "C"} for value in self.sequence):
            raise ValueError("Unknown toy symbol")
        if any(mode not in {"full", "cached"} for mode in self.modes):
            raise ValueError("Unknown cache mode")
        if len(set(self.chain)) != len(self.chain) or any(item not in BLOCK_ORDER for item in self.chain):
            raise ValueError("Unknown or repeated block component")
        if any(partition not in {0, 1, 2} for partition in self.partitions):
            raise ValueError("Unknown data partition")
        return self


class ExpeditionMove(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8, max_length=120)
    stage: int = Field(ge=0, le=2)
    state: LabState
    observed: list[float] = Field(min_length=1, max_length=40)
    hint_used: bool = False

    @model_validator(mode="after")
    def finite_observations(self):
        if any(not math.isfinite(value) for value in self.observed):
            raise ValueError("Observations must be finite")
        return self


def loss(weight):
    return sum((weight * x - 2 * x) ** 2 for x in [1, 2, 3]) / 3


def mechanics(node, stage, state):
    """Public toy mechanisms, never an independent mastery rubric."""
    s = state
    if node in FRONTIER_IDS:
        return frontier_mechanics(node, stage, s)
    if node in VOYAGE_IDS:
        return voyage_mechanics(node, stage, s)
    if node in TOWER_IDS:
        return tower_mechanics(node, stage, s)
    if node == "token":
        sentence = "AI让AI发光" if stage == 1 else "AI让学习发光"
        cuts = sorted(s.cuts)
        parts = [sentence[a:b] for a, b in zip([0, *cuts], [*cuts, len(sentence)])]
        vocab = {"AI": 0, "让": 1, "学习": 2, "发光": 3}
        if stage == 2:
            vocab["学习发光"] = 4
        metrics = [len(parts), *[vocab.get(part, -1) for part in parts]]
        valid = cuts == ([2, 3] if stage == 2 else [2, 3, 5]) and (stage != 1 or s.reason == "same-id")
    elif node == "embedding":
        target = [1, 2] if stage == 1 else [2, 0, 2]
        table = [[1, 0], [0, 1], [1, 1]]
        metrics = [len(s.rows), *[value for row in s.rows for value in table[row]]]
        valid = s.rows == target and (stage != 2 or s.reason == "address")
    elif node == "position":
        metrics = [2 + (index * s.amount if s.position_enabled else 0) for index in range(3)]
        valid = s.position_enabled and (s.amount > 0 if stage == 0 else abs(metrics[-1] - 6) < 1e-6) and (stage != 2 or s.reason == "order")
    elif node == "ffn":
        outputs = [max(0, 2 * x - 1) for x in s.inputs]
        metrics = [*s.inputs, *outputs]
        valid = s.inputs[0] >= 1 and s.inputs[2] == 3 and (s.inputs[1] == 2 if stage == 0 else s.inputs[1] <= 0) and (stage != 2 or s.reason == "pointwise")
    elif node == "loss":
        metrics = [*[s.weight * x for x in [1, 2, 3]], loss(s.weight), *[loss(probe) for probe in s.probes]]
        valid = (abs(s.weight - 2) < 1e-6 if stage == 0 else {1, 3} <= set(s.probes) if stage == 1 else s.reason == "squared-mean")
    elif node == "gradient":
        metrics = [(s.weight - 2) ** 2, 2 * (s.weight - 2), (s.weight - .1 - 2) ** 2, (s.weight + .1 - 2) ** 2]
        valid = 1 <= s.weight <= 2 if stage == 0 else 2 <= s.weight <= 3 if stage == 1 else abs(s.weight - 2) < 1e-6 and s.reason == "local-slope"
    elif node == "descent":
        w = 0
        path = [loss(w)]
        for _ in range(s.steps):
            w -= s.rate * (28 / 3) * (w - 2)
            path.append(loss(w))
        metrics = [w, *path]
        valid = s.steps >= 2 and (path[-1] > path[0] * 2 if stage == 1 else path[-1] < .01) and (stage != 2 or s.steps <= 4 and s.reason == "negative-gradient")
    elif node == "l2":
        error, penalty = (s.weight - 1) ** 2, s.lam * s.weight ** 2
        metrics = [error, penalty, error + penalty]
        valid = s.lam == 0 and abs(s.weight - 1) < 1e-6 if stage == 0 else s.lam == 1 and abs(s.weight - .5) < 1e-6 and (stage != 2 or s.reason == "tradeoff")
    elif node == "temperature":
        exp = [math.exp((logit - 3) / s.temperature) for logit in [0, 1, 3]]
        metrics = [value / sum(exp) for value in exp]
        valid = metrics[2] > .95 if stage == 0 else metrics[2] < .65 if stage == 1 else s.reason == "distribution"
    elif node == "entropy":
        p = s.probability
        metrics = [p, (1-p) * .75, (1-p) * .25, -math.log(p)]
        valid = metrics[-1] < .25 if stage == 0 else abs(p - .1) < 1e-6 if stage == 1 else s.reason == "target"
    elif node == "generation":
        target = ["A", "B"] if stage == 0 else ["A", "B", "C", "A"]
        metrics = [len(s.sequence), *[{"A": 0, "B": 1, "C": 2}[token] for token in s.sequence]]
        valid = s.sequence == target and (stage != 2 or s.reason == "append-history")
    elif node == "cache":
        q = [2, 2]
        full = attention(q, True, 10)["outputs"][-1]
        # Cached historical K/V plus the one appended pair reproduce the full last row.
        past = [(1, 0, 2), (0, 1, 6)]
        joined = [*past, (1, 1, 10)]
        scores = [(q[0]*x + q[1]*y) / math.sqrt(2) for x, y, _ in joined]
        exps = [math.exp(score - max(scores)) for score in scores]
        cached = sum(exp * item[2] for exp, item in zip(exps, joined)) / sum(exps)
        metrics = [full, cached, 1 if s.reuse else 3, 3]
        valid = {"full", "cached"} <= set(s.modes) if stage == 0 else s.reuse and (stage != 2 or s.reason == "reuse-history")
    else:
        raise ValueError("Unknown mechanism")
    return metrics, bool(valid)


def expedition_state(session, release_id):
    config = session.get(ContentRelease, release_id).manifest["expedition"]
    first = chapter_state(session, release_id)
    all_ids = NEW_IDS | {"beacon"}
    rows = {node: session.get(AdventureSession, session_id(node,learner_id(session))) for node in all_ids}
    nodes = []
    for definition in config["nodes"]:
        row = rows[definition["id"]]
        opened = all(rows[previous].stage == 3 for previous in definition["requires"])
        nodes.append({**definition, "title": definition["title"] if opened else "迷雾", "concept": definition["concept"] if opened else "随着探索显现",
                      "steps": definition["steps"] if opened else [], "discovery": definition["discovery"] if row.stage == 3 else "",
                      "boundary": definition["boundary"] if opened else "", "entity_ids": definition["entity_ids"] if row.stage == 3 else [],
                      "unlocked": opened, "stage": row.stage, "revision": row.revision, "release_id": row.release_id,
                      "trail": [{"stage": event["stage"], "created_at": event["created_at"], "hint_used": event["hint_used"]} for event in row.events]})
    chapters = []
    for chapter in config["chapters"]:
        group = [node for node in nodes if node["chapter"] == chapter["id"]]
        opened = any(node["unlocked"] for node in group)
        chapters.append({**chapter, "title": chapter["title"] if opened else "迷雾中的海域", "theme": chapter["theme"] if opened else "继续航行后显现",
                         "unlocked": opened, "completed": all(rows[node].stage == 3 for node in chapter["main_path"]),
                         "main_completed": sum(rows[node].stage == 3 for node in chapter["main_path"]), "all_explored": all(node["stage"] == 3 for node in group)})
    main_path = [node for chapter in config["chapters"] for node in chapter["main_path"]]
    next_node = next((node for node in main_path if rows[node].stage < 3), main_path[-1])
    return {"id": config["id"], "version": config["version"], "release_id": release_id, "first_chapter": first,
            "chapters": chapters, "nodes": nodes, "next_node": next_node, "unlocked": first["completed"],
            "chapter_total": 1 + len(chapters), "node_total": len(first["nodes"]) + len(nodes),
            "mechanism_total": len(first["nodes"]) * 3 + sum(len(node["steps"]) for node in config["nodes"]),
            "main_completed": first["main_completed"] + sum(rows[node].stage == 3 for node in main_path), "main_total": first["main_total"] + len(main_path),
            "completed": first["completed"] and all(rows[node].stage == 3 for node in main_path),
            "all_explored": first["all_explored"] and all(row.stage == 3 for key, row in rows.items() if key in NEW_IDS), "mastery": "unverified"}


@router.get("")
def current(request: Request):
    with request.app.state.sessions() as session:
        return expedition_state(session, request.app.state.release_id)


@router.get("/lessons/{chapter_id}")
def lesson(chapter_id: str, request: Request):
    if chapter_id not in {"representation", "learning", "generation", "tower", "optimization", "decoding", "architecture", "generalization"}:
        raise HTTPException(404, "Unknown chapter")
    with request.app.state.sessions() as session:
        state = expedition_state(session, request.app.state.release_id)
        if not next(chapter for chapter in state["chapters"] if chapter["id"] == chapter_id)["unlocked"]:
            raise HTTPException(403, "这片海域还没有开启。")
        release = session.get(ContentRelease, request.app.state.release_id)
        return {"release_id": release.id, "status": "draft", "markdown": release.manifest["expedition_lessons"][chapter_id + ".md"]}


@router.post("/{node}/moves")
def move(node: str, body: ExpeditionMove, request: Request):
    if node not in NEW_IDS:
        raise HTTPException(404, "Unknown expedition island")
    with request.app.state.sessions() as session:
        # One chapter lock order; no new tables or mutation of the old personal map.
        session.scalar(select(AdventureSession).where(AdventureSession.id == learner_id(session)).with_for_update())
        row = session.scalar(select(AdventureSession).where(AdventureSession.id == session_id(node,learner_id(session))).with_for_update())
        pinned = session.get(ContentRelease, row.release_id).manifest["expedition"]
        definition = next(item for item in pinned["nodes"] if item["id"] == node)
        if any(session.get(AdventureSession, session_id(previous,learner_id(session))).stage != 3 for previous in definition["requires"]):
            raise HTTPException(403, "这片光路还没接通，请先完成相邻主线。")
        digest = hashlib.sha256(json.dumps(body.model_dump(), sort_keys=True).encode()).hexdigest()
        prior = next((event for event in row.events if event["operation_key"] == body.operation_key), None)
        if prior:
            if prior["request_hash"] != digest:
                raise HTTPException(409, "同一次操作不能对应不同机关。")
            return prior["result"]
        if body.base_revision != row.revision or body.stage != row.stage:
            raise HTTPException(409, "航迹已更新，请返回群岛总览重新进入。")
        metrics, valid = mechanics(node, body.stage, body.state)
        if len(metrics) != len(body.observed) or any(abs(a-b) > 1e-6 * max(1, abs(a)) for a, b in zip(metrics, body.observed)):
            raise HTTPException(422, "机关读数与参考计算不一致。")
        if not valid:
            raise HTTPException(422, "还没有达到当前目标，再观察变化与条件。")
        row.stage += 1
        row.revision += 1
        event = {**body.model_dump(), "created_at": now().isoformat(), "request_hash": digest, "rule_version": pinned["version"]}
        row.events = [*row.events, event]
        result = expedition_state(session, request.app.state.release_id)
        row.events = [*row.events[:-1], {**event, "result": result}]
        session.commit()
        return result
