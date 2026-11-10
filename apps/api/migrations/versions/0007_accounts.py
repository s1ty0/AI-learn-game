"""Accounts, scoped sessions and one-use invitations; old local records stay in place."""
from alembic import op
import sqlalchemy as sa

revision="0007"
down_revision="0006"
branch_labels=None
depends_on=None


def upgrade():
    op.create_table("accounts",sa.Column("id",sa.String(),primary_key=True),sa.Column("username",sa.String(40),nullable=False,unique=True),sa.Column("password_hash",sa.String(),nullable=False),sa.Column("graph_id",sa.String(),sa.ForeignKey("learner_graphs.id"),nullable=False,unique=True),sa.Column("enabled",sa.Integer(),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("legacy_claimed_at",sa.DateTime(timezone=True),nullable=True),sa.Column("previous_graph_id",sa.String(),nullable=True))
    op.create_table("auth_sessions",sa.Column("token_hash",sa.String(),primary_key=True),sa.Column("account_id",sa.String(),sa.ForeignKey("accounts.id"),nullable=False),sa.Column("expires_at",sa.DateTime(timezone=True),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False))
    op.create_index("ix_auth_sessions_account_id","auth_sessions",["account_id"])
    op.create_table("auth_invites",sa.Column("token_hash",sa.String(),primary_key=True),sa.Column("expires_at",sa.DateTime(timezone=True),nullable=False),sa.Column("used_by",sa.String(),sa.ForeignKey("accounts.id"),nullable=True),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False))
    op.add_column("review_actors",sa.Column("learner_id",sa.String(),server_default="local-demo",nullable=False))
    op.drop_constraint("attempts_operation_key_key","attempts",type_="unique")
    op.create_unique_constraint("uq_attempt_owner_operation","attempts",["owner","operation_key"])


def downgrade():
    if op.get_bind().execute(sa.text("SELECT count(*) FROM accounts")).scalar():
        raise RuntimeError("已有账号；请保留新表并回滚兼容应用版本，不能用降级删除用户数据。")
    op.drop_constraint("uq_attempt_owner_operation","attempts",type_="unique")
    op.create_unique_constraint("attempts_operation_key_key","attempts",["operation_key"])
    op.drop_column("review_actors","learner_id")
    op.drop_table("auth_invites")
    op.drop_table("auth_sessions")
    op.drop_table("accounts")
