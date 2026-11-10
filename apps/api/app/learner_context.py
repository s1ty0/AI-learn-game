"""Request identity is server-owned; gameplay code never reads a client owner field."""
from contextvars import ContextVar
from fastapi import HTTPException

current_graph:ContextVar[str|None]=ContextVar("current_learner_graph",default=None)


def learner_id(session):
    value=session.info.get("learner_id")
    if not value:raise HTTPException(401,"请先登录，再访问自己的学习档案。")
    return value
