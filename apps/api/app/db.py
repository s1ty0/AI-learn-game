import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def database_url():
    value = os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is required; run pnpm dev from the repository root")
    return value


def engine_for(url=None):
    return create_engine(url or database_url(), pool_pre_ping=True)


def session_factory(engine):
    return sessionmaker(engine, expire_on_commit=False)
