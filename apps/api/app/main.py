import hashlib
import json
import math
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import select

from .content import DEMO_GRAPH, ROOT, seed
from .db import engine_for, session_factory
from .models import ContentRelease, EntityRevision, LearnerGraph, GraphSnapshot, GraphOperation, Attempt, AdventureSession, now
from .schemas import GraphMutation, RestoreMutation, AttemptSubmission, AdventureMove, PrismMove
from .chapter import router as chapter_router
from .expedition import router as expedition_router


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def create_app(database_engine=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.engine = database_engine or engine_for()
        app.state.sessions = session_factory(app.state.engine)
        with app.state.sessions() as session:
            app.state.release_id = seed(session)
        yield
        if database_engine is None:
            app.state.engine.dispose()

    app = FastAPI(title="LearnAI Local Prototype", version="0.1.0", lifespan=lifespan)

    def session_dep():
        with app.state.sessions() as session:
            yield session

    def graph_head(session):
        graph = session.scalar(select(LearnerGraph).where(LearnerGraph.id == DEMO_GRAPH).with_for_update())
        if graph is None:
            raise HTTPException(404, "Graph missing")
        return graph

    def snapshot_data(snapshot):
        return {"revision": snapshot.revision, "release_id": snapshot.release_id, "payload": snapshot.payload,
                "note": snapshot.note, "restored_from": snapshot.restored_from, "created_at": snapshot.created_at.isoformat()}

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok", "mode": "local-demo", "database": "postgresql"}

    @app.get("/api/v1/content")
    def content(session=Depends(session_dep)):
        release = session.get(ContentRelease, app.state.release_id)
        entities = session.scalars(select(EntityRevision).where(EntityRevision.release_id == release.id)).all()
        return {"release_id": release.id, "version": release.manifest["version"], "status": "draft",
                "entities": [{"id": e.entity_id, "name": e.data["name"], "aliases": e.data["aliases"],
                              "domain_ids": e.data["domain_ids"]} for e in entities]}

    @app.get("/api/v1/lesson")
    def lesson(module: str = "multihead-and-mask.md", session=Depends(session_dep)):
        allowed = {"README.md", "input-and-position.md", "multihead-and-mask.md", "block-components.md", "training-and-generation.md", "missions.md"}
        if module not in allowed:
            raise HTTPException(404, "Lesson not available in this prototype")
        release = session.get(ContentRelease, app.state.release_id)
        return {"title": "为什么模型不能偷看未来？", "status": "draft", "release_id": release.id,
                "markdown": release.manifest["lessons"][module]}

    @app.get("/api/v1/learner-graph")
    def current(session=Depends(session_dep)):
        graph = session.get(LearnerGraph, DEMO_GRAPH)
        return snapshot_data(session.get(GraphSnapshot, (DEMO_GRAPH, graph.revision)))

    @app.get("/api/v1/learner-graph/versions")
    def versions(session=Depends(session_dep)):
        rows = session.scalars(select(GraphSnapshot).where(GraphSnapshot.graph_id == DEMO_GRAPH).order_by(GraphSnapshot.revision.desc())).all()
        return [{"revision": r.revision, "note": r.note, "created_at": r.created_at.isoformat(), "restored_from": r.restored_from} for r in rows]

    @app.get("/api/v1/learner-graph/versions/{revision}")
    def version(revision: int, session=Depends(session_dep)):
        row = session.get(GraphSnapshot, (DEMO_GRAPH, revision))
        if row is None:
            raise HTTPException(404, "Version not found")
        return snapshot_data(row)

    def apply(session, graph, base, key, digest, payload, release_id, note, restored_from=None):
        prior = session.scalar(select(GraphOperation).where(GraphOperation.graph_id == DEMO_GRAPH, GraphOperation.operation_key == key))
        if prior:
            if prior.request_hash != digest:
                raise HTTPException(409, {"code": "operation_key_reused", "message": "同一个操作键对应了不同内容，请重新提交。"})
            return snapshot_data(session.get(GraphSnapshot, (DEMO_GRAPH, prior.result_revision)))
        if base != graph.revision:
            raise HTTPException(409, {"code": "revision_conflict", "current_revision": graph.revision,
                                      "message": "另一处已更新此图。你的草稿已保留，请先查看最新版本。"})
        graph.revision += 1
        row = GraphSnapshot(graph_id=DEMO_GRAPH, revision=graph.revision, release_id=release_id,
                            payload=payload, note=note, restored_from=restored_from)
        session.add(row)
        session.add(GraphOperation(id=str(uuid4()), graph_id=DEMO_GRAPH, operation_key=key, base_revision=base,
                                   result_revision=graph.revision, request_hash=digest))
        session.commit()
        return snapshot_data(row)

    @app.post("/api/v1/learner-graph/operations")
    def mutate(body: GraphMutation, session=Depends(session_dep)):
        graph = graph_head(session)
        base_snapshot = session.get(GraphSnapshot, (DEMO_GRAPH, graph.revision))
        return apply(session, graph, body.base_revision, body.operation_key, fingerprint(body.model_dump()),
                     body.payload.model_dump(), base_snapshot.release_id, body.note)

    @app.post("/api/v1/learner-graph/restore")
    def restore(body: RestoreMutation, session=Depends(session_dep)):
        graph = graph_head(session)
        old = session.get(GraphSnapshot, (DEMO_GRAPH, body.revision))
        if old is None:
            raise HTTPException(404, "Version not found")
        return apply(session, graph, body.base_revision, body.operation_key, fingerprint(body.model_dump()),
                     old.payload, old.release_id, f"从 v{body.revision} 恢复为新版本", body.revision)

    @app.post("/api/v1/attempts")
    def attempt(body: AttemptSubmission, session=Depends(session_dep)):
        # One local demo owner, serialized idempotency check via the same graph row.
        graph_head(session)
        digest = fingerprint(body.model_dump())
        previous = session.scalar(select(Attempt).where(Attempt.operation_key == body.operation_key))
        if previous:
            if previous.request_hash != digest:
                raise HTTPException(409, "Attempt key reused with different content")
            return {"id": previous.id, **previous.evaluation}
        values = [2.0, 6.0, body.future_value]
        expected = [2.0, 5.0, sum(w*v for w, v in zip([1/6, 3/6, 2/6], values))] if body.mask_enabled else [sum(w*v for w, v in zip([1/6, 3/6, 2/6], values))]*3
        if any(not math.isfinite(x) or abs(x-y) > 1e-5 for x, y in zip(body.observed, expected)):
            raise HTTPException(422, "Experiment output does not match the reference calculation")
        correct = body.prediction == "same"
        evaluation = {"numeric_check": "passed", "prediction_correct": correct, "status": "needs_review",
                      "content_release": app.state.release_id, "rule_version": "causal-mask-numeric-v1",
                      "message": ("预测与数值检查一致。" if correct else "请对比开关掩码前后，重新判断前两位置能读到什么。")
                      + "解释已保存，仍待复核；本次不自动标记掌握。",
                      "next_step": "补充‘因果掩码限制信息访问’这条关系，并用自己的话说明原因。"}
        row = Attempt(id=str(uuid4()), operation_key=body.operation_key, request_hash=digest,
                      task_id=body.task_id, task_version=f"{app.state.release_id}:{body.task_id}", owner="local-demo",
                      response=body.model_dump(), evaluation=evaluation)
        session.add(row)
        session.commit()
        return {"id": row.id, **evaluation}

    @app.get("/api/v1/attempts")
    def attempts(session=Depends(session_dep)):
        rows = session.scalars(select(Attempt).where(Attempt.owner == "local-demo").order_by(Attempt.created_at.desc()).limit(20)).all()
        return [{"id": r.id, "created_at": r.created_at.isoformat(), "prediction": r.response["prediction"],
                 "explanation": r.response["explanation"], **r.evaluation} for r in rows]

    def adventure_data(row):
        # Discovery is an exploration reward, never evidence of verified mastery.
        return {"revision": row.revision, "stage": row.stage, "release_id": row.release_id, "rule_version": "island-mask-v1",
                "discovered": ["entity-0068"] if row.stage == 3 else [], "mastery": "unverified",
                "trail": [{"stage": e["stage"], "created_at": e["created_at"], "hint_used": e["hint_used"]}
                          for e in row.events]}

    @app.get("/api/v1/adventure")
    def adventure(session=Depends(session_dep)):
        return adventure_data(session.get(AdventureSession, DEMO_GRAPH))

    @app.post("/api/v1/adventure/moves")
    def adventure_move(body: AdventureMove, session=Depends(session_dep)):
        row = session.scalar(select(AdventureSession).where(AdventureSession.id == DEMO_GRAPH).with_for_update())
        digest = fingerprint(body.model_dump())
        previous = next((event for event in row.events if event["operation_key"] == body.operation_key), None)
        if previous:
            if previous["request_hash"] != digest:
                raise HTTPException(409, "同一探索操作不能对应不同内容。")
            return previous["result"]
        if body.base_revision != row.revision or body.stage != row.stage:
            raise HTTPException(409, "探索进度已更新，请重新同步；当前机关操作仍保留在屏幕上。")
        full_output = (20 + 2 * body.future_value) / 6
        valid = ((body.stage == 0 and body.mask_enabled and body.future_value >= 20)
                 or (body.stage == 1 and not body.mask_enabled and body.future_value >= 20)
                 or (body.stage == 2 and body.mask_enabled and full_output > 10 and body.reason == "blocked"))
        if not valid:
            raise HTTPException(422, "机关还没达到目标，再观察光路和读数。")
        row.stage += 1
        row.revision += 1
        event = {**body.model_dump(), "created_at": now().isoformat(), "request_hash": digest, "rule_version": "island-mask-v1"}
        row.events = [*row.events, event]
        result = adventure_data(row)
        event["result"] = result
        row.events = [*row.events[:-1], event]
        session.commit()
        return result

    def prism_data(session, row):
        opened = session.get(AdventureSession, DEMO_GRAPH).stage == 3
        return {"unlocked": opened, "revision": row.revision, "stage": row.stage,
                "release_id": row.release_id, "rule_version": "prism-softmax-v1", "mastery": "unverified",
                "discovered": ["entity-0142", "entity-0147"] if row.stage == 3 else [],
                "trail": [{"stage": e["stage"], "created_at": e["created_at"], "hint_used": e["hint_used"]} for e in row.events]}

    @app.get("/api/v1/adventure/prism")
    def prism(session=Depends(session_dep)):
        return prism_data(session, session.get(AdventureSession, DEMO_GRAPH + ":prism"))

    @app.post("/api/v1/adventure/prism/moves")
    def prism_move(body: PrismMove, session=Depends(session_dep)):
        row = session.scalar(select(AdventureSession).where(AdventureSession.id == DEMO_GRAPH + ":prism").with_for_update())
        if session.get(AdventureSession, DEMO_GRAPH).stage != 3:
            raise HTTPException(403, "先发现回声小岛的光路，再进入分光台。")
        digest = fingerprint(body.model_dump())
        prior = next((e for e in row.events if e["operation_key"] == body.operation_key), None)
        if prior:
            if prior["request_hash"] != digest:
                raise HTTPException(409, "同一操作不能对应不同配置。")
            return prior["result"]
        if body.stage != row.stage or body.base_revision != row.revision:
            raise HTTPException(409, "分光台进度已更新，请重新同步。")
        exp = [math.exp(score - max(body.scores)) for score in body.scores]
        weights = [value / sum(exp) for value in exp]
        output = sum(weight * value for weight, value in zip(weights, [2, 6, 10]))
        if abs(body.output - output) > 1e-6 or any(abs(a-b) > 1e-6 for a, b in zip(weights, body.weights)):
            raise HTTPException(422, "光束读数与参考计算不一致。")
        valid = ((body.stage == 0 and max(body.scores) - min(body.scores) < 1e-6)
                 or (body.stage == 1 and output > 8)
                 or (body.stage == 2 and output < 4 and body.reason == "relative"))
        if not valid:
            raise HTTPException(422, "还没有达到这一步的光束目标。")
        row.stage += 1
        row.revision += 1
        event = {**body.model_dump(), "created_at": now().isoformat(), "request_hash": digest, "rule_version": "prism-softmax-v1"}
        row.events = [*row.events, event]
        result = prism_data(session, row)
        row.events = [*row.events[:-1], {**event, "result": result}]
        session.commit()
        return result

    app.include_router(chapter_router)
    app.include_router(expedition_router)
    return app


app = create_app()
