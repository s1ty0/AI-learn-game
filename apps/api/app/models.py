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
    __table_args__ = (UniqueConstraint("owner","operation_key",name="uq_attempt_owner_operation"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    operation_key: Mapped[str] = mapped_column(String)
    request_hash: Mapped[str] = mapped_column(String)
    task_id: Mapped[str] = mapped_column(String)
    task_version: Mapped[str] = mapped_column(String)
    owner: Mapped[str] = mapped_column(String)
    response: Mapped[dict] = mapped_column(JSONB)
    evaluation: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ReviewActor(Base):
    __tablename__ = "review_actors"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    enabled: Mapped[int] = mapped_column(Integer, default=1)
    learner_id: Mapped[str] = mapped_column(String,default="local-demo",server_default="local-demo")


class ReviewCase(Base):
    __tablename__ = "review_cases"
    attempt_id: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    events: Mapped[list] = mapped_column(JSONB, default=list)


class VerificationSession(Base):
    __tablename__ = "verification_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    events: Mapped[list] = mapped_column(JSONB, default=list)


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


class Account(Base):
    __tablename__="accounts"
    id:Mapped[str]=mapped_column(String,primary_key=True)
    username:Mapped[str]=mapped_column(String(40),unique=True)
    password_hash:Mapped[str]=mapped_column(String)
    graph_id:Mapped[str]=mapped_column(ForeignKey("learner_graphs.id"),unique=True)
    enabled:Mapped[int]=mapped_column(Integer,default=1)
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
    legacy_claimed_at:Mapped[datetime|None]=mapped_column(DateTime(timezone=True),nullable=True)
    previous_graph_id:Mapped[str|None]=mapped_column(String,nullable=True)


class AuthSession(Base):
    __tablename__="auth_sessions"
    token_hash:Mapped[str]=mapped_column(String,primary_key=True)
    account_id:Mapped[str]=mapped_column(ForeignKey("accounts.id"),index=True)
    expires_at:Mapped[datetime]=mapped_column(DateTime(timezone=True))
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)


class AuthInvite(Base):
    __tablename__="auth_invites"
    token_hash:Mapped[str]=mapped_column(String,primary_key=True)
    expires_at:Mapped[datetime]=mapped_column(DateTime(timezone=True))
    used_by:Mapped[str|None]=mapped_column(ForeignKey("accounts.id"),nullable=True)
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
