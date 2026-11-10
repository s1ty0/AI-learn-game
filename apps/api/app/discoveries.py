"""Read only exploration evidence; discovery is never mastery or a graph edit."""

from fastapi import APIRouter, Request
from sqlalchemy import select

from .learner_context import learner_id
from .chapter import session_id
from .models import AdventureSession, ContentRelease, EntityRevision, RelationRevision

router = APIRouter(prefix="/api/v1/discoveries")


def discovery_state(session, release_id):
    release = session.get(ContentRelease, release_id)
    config = release.manifest
    chapters = [{"id": "information-sea", "title": "信息之海"},
                *[{"id": c["id"], "title": c["title"]} for c in config["expedition"]["chapters"]]]
    definitions = [{**node, "chapter": "information-sea"} for node in config["chapter"]["nodes"]] + config["expedition"]["nodes"]
    rows = {row.id: row for row in session.scalars(select(AdventureSession).where(AdventureSession.id.in_([session_id(n["id"],learner_id(session)) for n in definitions]))).all()}
    entities = {row.entity_id: row.data for row in session.scalars(select(EntityRevision).where(EntityRevision.release_id == release_id)).all()}
    found = {}
    opened = set()
    for node in definitions:
        row = rows.get(session_id(node["id"],learner_id(session)))
        if row is None or row.stage != 3:
            continue
        opened.add(node["chapter"])
        for entity_id in node["entity_ids"]:
            if entity_id not in entities:
                continue
            if entity_id not in found:
                found[entity_id] = {"id": entity_id, "name": entities[entity_id]["name"], "chapters": [], "origins": []}
            if node["chapter"] not in found[entity_id]["chapters"]:
                found[entity_id]["chapters"].append(node["chapter"])
            found[entity_id]["origins"].append({"node_id": node["id"], "title": node["title"], "chapter": node["chapter"],
                "release_id": row.release_id, "completed_at": row.events[-1]["created_at"] if row.events else None,
                "hint_used": any(event.get("hint_used", False) for event in row.events)})
    relations = []
    for row in session.scalars(select(RelationRevision).where(RelationRevision.release_id == release_id)).all():
        if row.source_id in found and row.target_id in found:
            data = row.data
            relations.append({"id": row.relation_id, "source": row.source_id, "target": row.target_id,
                "statement": data["statement"], "conditions": data["conditions"], "review_status": data["review_status"],
                "source_ids": data["source_ids"], "release_id": release_id})
    return {"release_id": release_id, "status": "draft", "mastery": "unverified",
            "chapters": [chapter for chapter in chapters if chapter["id"] in opened],
            "entities": list(found.values()), "relations": relations}


@router.get("")
def current(request: Request):
    with request.app.state.sessions() as session:
        return discovery_state(session, request.app.state.release_id)
