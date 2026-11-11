"""Cloud deployment boundaries: driver compatibility, origins and cold starts."""
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from starlette.requests import Request

from app.auth import browser_write
from app.db import Base, engine_for
from app.main import create_app
from app.models import ContentRelease, LearnerGraph


@pytest.mark.parametrize("prefix", ["postgres", "postgresql", "postgresql+psycopg"])
def test_managed_database_url_preserves_tls_and_uses_installed_driver(prefix):
    engine = engine_for(f"{prefix}://example:example@localhost/unused?sslmode=require")
    try:
        assert engine.url.drivername == "postgresql+psycopg"
        assert engine.url.query["sslmode"] == "require"
    finally:
        engine.dispose()


def test_production_origin_uses_platform_config_not_request_host(monkeypatch):
    monkeypatch.delenv("LEARN_WEB_ORIGIN", raising=False)
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.setenv("VERCEL_PROJECT_PRODUCTION_URL", "learn.example.com")
    monkeypatch.setenv("VERCEL_URL", "preview.example.com")
    app = create_app(allow_local_demo=False)
    assert app.state.web_origin == "https://learn.example.com"
    def request(origin):
        return Request({"type": "http", "app": app, "method": "POST", "path": "/",
                        "headers": [(b"host", b"attacker.example.com"),
                                    (b"origin", origin.encode()), (b"x-learnai-request", b"1")]})
    browser_write(request("https://learn.example.com"))
    with pytest.raises(HTTPException) as error:
        browser_write(request("https://attacker.example.com"))
    assert error.value.status_code == 403
    monkeypatch.setenv("LEARN_WEB_ORIGIN", "https://custom.example.com")
    assert create_app(allow_local_demo=False).state.web_origin == "https://custom.example.com"


def test_two_cold_starts_share_one_initial_release():
    schema = "test_" + uuid4().hex
    admin = create_engine(os.environ["DATABASE_URL"])
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(os.environ["DATABASE_URL"], connect_args={"options": f"-csearch_path={schema}"})
    Base.metadata.create_all(engine)
    try:
        def start(_):
            with TestClient(create_app(engine, allow_local_demo=False)) as client:
                return client.get("/api/v1/content").json()["release_id"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            releases = list(pool.map(start, range(2)))
        assert len(set(releases)) == 1
        with engine.connect() as connection:
            assert len(connection.execute(select(ContentRelease.id)).all()) == 1
            assert len(connection.execute(select(LearnerGraph.id)).all()) == 1
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
