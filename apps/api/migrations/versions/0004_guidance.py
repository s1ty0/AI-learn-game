"""Preserve guidance feedback separately from exploration and mastery."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("guidance_sessions", sa.Column("id", sa.String(), primary_key=True),
                    sa.Column("revision", sa.Integer(), nullable=False), sa.Column("events", JSONB, nullable=False))


def downgrade():
    raise RuntimeError("Guidance history must be preserved; use a reviewed forward migration.")
