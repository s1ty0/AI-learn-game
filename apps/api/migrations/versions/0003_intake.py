"""Persist local intake evidence without touching exploration or graph history."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("intake_sessions", sa.Column("id", sa.String(), primary_key=True),
                    sa.Column("revision", sa.Integer(), nullable=False),
                    sa.Column("finished", sa.Integer(), nullable=False),
                    sa.Column("events", postgresql.JSONB(), nullable=False))


def downgrade():
    raise RuntimeError("Intake evidence must be preserved; use a reviewed forward migration.")
