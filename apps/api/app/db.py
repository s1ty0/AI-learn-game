import os

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def database_url():
    value = os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is required; run pnpm dev from the repository root")
    return value


def engine_for(url=None):
    target = make_url(url or database_url())
    if target.drivername in {"postgres", "postgresql"}:
        target = target.set(drivername="postgresql+psycopg")
    options = {"pool_pre_ping": True}
    if os.environ.get("VERCEL") == "1":
        options.update(pool_size=2, max_overflow=2, pool_recycle=300)
    return create_engine(target, **options)


def session_factory(engine):
    return sessionmaker(engine, expire_on_commit=False)
