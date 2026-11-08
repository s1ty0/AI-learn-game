"""Initial local learning-loop schema. No downgrade deletion is provided."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None


def upgrade():
    op.create_table("content_releases", sa.Column("id", sa.String, primary_key=True), sa.Column("manifest", JSONB, nullable=False))
    op.create_table("entity_revisions", sa.Column("release_id", sa.String, sa.ForeignKey("content_releases.id"), primary_key=True),
                    sa.Column("entity_id", sa.String, primary_key=True), sa.Column("data", JSONB, nullable=False))
    op.create_table("relation_revisions", sa.Column("release_id", sa.String, sa.ForeignKey("content_releases.id"), primary_key=True),
                    sa.Column("relation_id", sa.String, primary_key=True), sa.Column("source_id", sa.String, nullable=False),
                    sa.Column("target_id", sa.String, nullable=False), sa.Column("data", JSONB, nullable=False))
    op.create_index("ix_relation_revisions_source_id", "relation_revisions", ["source_id"])
    op.create_index("ix_relation_revisions_target_id", "relation_revisions", ["target_id"])
    op.create_table("learner_graphs", sa.Column("id", sa.String, primary_key=True), sa.Column("owner", sa.String, nullable=False), sa.Column("revision", sa.Integer, nullable=False))
    op.create_table("graph_snapshots", sa.Column("graph_id", sa.String, sa.ForeignKey("learner_graphs.id"), primary_key=True),
                    sa.Column("revision", sa.Integer, primary_key=True), sa.Column("release_id", sa.String, sa.ForeignKey("content_releases.id"), nullable=False),
                    sa.Column("payload", JSONB, nullable=False), sa.Column("note", sa.String, nullable=False),
                    sa.Column("restored_from", sa.Integer), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("graph_operations", sa.Column("id", sa.String, primary_key=True),
                    sa.Column("graph_id", sa.String, sa.ForeignKey("learner_graphs.id"), nullable=False),
                    sa.Column("operation_key", sa.String, nullable=False), sa.Column("base_revision", sa.Integer, nullable=False),
                    sa.Column("result_revision", sa.Integer, nullable=False), sa.Column("request_hash", sa.String, nullable=False),
                    sa.UniqueConstraint("graph_id", "operation_key"))
    op.create_table("attempts", sa.Column("id", sa.String, primary_key=True), sa.Column("operation_key", sa.String, nullable=False, unique=True),
                    sa.Column("request_hash", sa.String, nullable=False), sa.Column("task_id", sa.String, nullable=False),
                    sa.Column("task_version", sa.String, nullable=False), sa.Column("owner", sa.String, nullable=False),
                    sa.Column("response", JSONB, nullable=False), sa.Column("evaluation", JSONB, nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    raise RuntimeError("Historical learning data requires an explicit reviewed migration; no destructive downgrade.")
