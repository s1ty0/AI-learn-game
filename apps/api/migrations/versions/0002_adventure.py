"""Keep exploration progress separate from validated learning mastery."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0002"
down_revision = "0001"


def upgrade():
    op.create_table("adventure_sessions",
                    sa.Column("id", sa.String, primary_key=True),
                    sa.Column("release_id", sa.String, sa.ForeignKey("content_releases.id"), nullable=False),
                    sa.Column("revision", sa.Integer, nullable=False),
                    sa.Column("stage", sa.Integer, nullable=False),
                    sa.Column("events", JSONB, nullable=False))


def downgrade():
    raise RuntimeError("Exploration history must be preserved; use a reviewed forward migration.")
