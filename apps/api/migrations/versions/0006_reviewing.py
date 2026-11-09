"""Reviewer capability identity and append-only case review history."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision="0006"
down_revision="0005"
branch_labels=None
depends_on=None


def upgrade():
    op.create_table("review_actors",sa.Column("id",sa.String(),primary_key=True),sa.Column("name",sa.String(),nullable=False),sa.Column("token_hash",sa.String(),nullable=False,unique=True),sa.Column("enabled",sa.Integer(),nullable=False))
    op.create_table("review_cases",sa.Column("attempt_id",sa.String(),primary_key=True),sa.Column("revision",sa.Integer(),nullable=False),sa.Column("events",JSONB,nullable=False))


def downgrade():
    raise RuntimeError("Review history must be preserved; use a reviewed forward migration.")
