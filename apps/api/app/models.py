from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now():
    return datetime.now(timezone.utc)


class ContentRelease(Base):
    __tablename__ = "content_releases"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    manifest: Mapped[dict] = mapped_column(JSONB)


class EntityRevision(Base):
    __tablename__ = "entity_revisions"
    release_id: Mapped[str] = mapped_column(ForeignKey("content_releases.id"), primary_key=True)
    entity_id: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB)


class RelationRevision(Base):
    __tablename__ = "relation_revisions"
    release_id: Mapped[str] = mapped_column(ForeignKey("content_releases.id"), primary_key=True)
    relation_id: Mapped[str] = mapped_column(String, primary_key=True)
    source_id: Mapped[str] = mapped_column(String, index=True)
    target_id: Mapped[str] = mapped_column(String, index=True)
    data: Mapped[dict] = mapped_column(JSONB)


class LearnerGraph(Base):
    __tablename__ = "learner_graphs"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner: Mapped[str] = mapped_column(String)
    revision: Mapped[int] = mapped_column(Integer, default=0)


class GraphSnapshot(Base):
    __tablename__ = "graph_snapshots"
    graph_id: Mapped[str] = mapped_column(ForeignKey("learner_graphs.id"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    release_id: Mapped[str] = mapped_column(ForeignKey("content_releases.id"))
    payload: Mapped[dict] = mapped_column(JSONB)
    note: Mapped[str] = mapped_column(String)
    restored_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class GraphOperation(Base):
    __tablename__ = "graph_operations"
    __table_args__ = (UniqueConstraint("graph_id", "operation_key"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    graph_id: Mapped[str] = mapped_column(ForeignKey("learner_graphs.id"))
    operation_key: Mapped[str] = mapped_column(String)
    base_revision: Mapped[int] = mapped_column(Integer)
    result_revision: Mapped[int] = mapped_column(Integer)
    request_hash: Mapped[str] = mapped_column(String)


class Attempt(Base):
    __tablename__ = "attempts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    operation_key: Mapped[str] = mapped_column(String, unique=True)
    request_hash: Mapped[str] = mapped_column(String)
    task_id: Mapped[str] = mapped_column(String)
    task_version: Mapped[str] = mapped_column(String)
    owner: Mapped[str] = mapped_column(String)
    response: Mapped[dict] = mapped_column(JSONB)
    evaluation: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class GuidanceSession(Base):
    __tablename__ = "guidance_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    events: Mapped[list] = mapped_column(JSONB, default=list)


class IntakeSession(Base):
    __tablename__ = "intake_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    finished: Mapped[int] = mapped_column(Integer, default=0)
    events: Mapped[list] = mapped_column(JSONB, default=list)


class AdventureSession(Base):
    __tablename__ = "adventure_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    release_id: Mapped[str] = mapped_column(ForeignKey("content_releases.id"))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    stage: Mapped[int] = mapped_column(Integer, default=0)
    events: Mapped[list] = mapped_column(JSONB, default=list)
