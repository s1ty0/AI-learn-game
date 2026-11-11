from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import auth
from app.auth import COOKIE,digest
from app.account_access import claim_demo
from app.main import create_app
from app.models import Account,AuthSession,AuthInvite,AdventureSession,ReviewActor,VerificationSession,now
from test_learning_loop import client,mutation

PASSWORD="fixture-long-passphrase-2026"
WRITE={"X-LearnAI-Request":"1"}


def invitation(app,code=None,expired=False):
    code=code or str(uuid4())
    with app.state.sessions() as session,session.begin():session.add(AuthInvite(token_hash=digest(code),expires_at=now()+timedelta(days=-1 if expired else 1)))
    return code


def register(browser,username,code=None):
    response=browser.post("/api/v1/auth/register",json={"username":username,"password":PASSWORD,"invite":code or invitation(browser.app)},headers=WRITE)
    if response.status_code==200:browser.headers.update({**WRITE,"X-LearnAI-Account":response.json()["user"]["id"]})
    return response


@pytest.fixture
def pair(client):
    app=create_app(client.app.state.engine,allow_local_demo=False)
    with TestClient(app,base_url="https://testserver") as alice:
        app.state.web_origin="https://testserver"
        bob=TestClient(app,base_url="https://testserver")
        try:yield alice,bob
        finally:bob.close()


def graph_id(browser,name):
    with browser.app.state.sessions() as session:return session.scalar(select(Account.graph_id).where(Account.username==name))


def post_action(browser,state,action,**values):
    return browser.post("/api/v1/verification/actions",json={"base_revision":state["revision"],"operation_key":str(uuid4()),"action":action,**values})


def advanced(browser,name):
    identity=graph_id(browser,name)
    with browser.app.state.sessions() as session,session.begin():
        for node in [identity,identity+":prism",identity+":query",identity+":token",identity+":embedding"]:session.get(AdventureSession,node).stage=3


def test_production_default_requires_login_for_every_learning_family(pair):
    a,_=pair
    for path in ["learner-graph","learner-graph/versions","attempts","adventure","adventure/prism","chapter","expedition","discoveries","intake","guidance","verification","candidates","star-evidence","relation-evidence/seed-1","relation-revisions/missing"]:
        assert a.get("/api/v1/"+path).status_code==401,path
    assert a.get("/api/v1/health").json()["mode"]=="accounts-required"
    assert a.get("/api/v1/auth/session").json()=={"user":None,"mode":"required","demo_available":False,"invite_required":True}


def test_registration_uses_single_use_invitation_hashed_password_and_opaque_cookie(pair):
    a,b=pair;code=invitation(a.app)
    response=register(a,"Alice",code);assert response.status_code==200
    assert response.json()["user"]["username"]=="alice"
    cookie=response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=strict" in cookie
    assert "password" not in str(response.json()) and PASSWORD not in cookie
    assert register(b,"bob",code).status_code==403
    with a.app.state.sessions() as session:
        account=session.scalar(select(Account).where(Account.username=="alice"))
        assert account.password_hash.startswith("scrypt$131072$8$1$") and PASSWORD not in account.password_hash
        assert session.get(AuthSession,digest(a.cookies.get(COOKIE))).account_id==account.id
        assert session.get(AuthInvite,digest(code)).used_by==account.id


def test_open_registration_without_invites_keeps_private_account_scopes(client,monkeypatch):
    monkeypatch.setenv("LEARN_OPEN_REGISTRATION","1")
    app=create_app(client.app.state.engine,allow_local_demo=False)
    with TestClient(app,base_url="https://testserver") as a,TestClient(app,base_url="https://testserver") as b:
        app.state.web_origin="https://testserver"
        status=a.get("/api/v1/auth/session").json()
        assert status=={"user":None,"mode":"required","demo_available":False,"invite_required":False}
        assert a.get("/api/v1/learner-graph").status_code==401
        users=[]
        for browser,name,extra in [(a,"alice",{}),(b,"bob",{"invite":""})]:
            response=browser.post("/api/v1/auth/register",json={"username":name,"password":PASSWORD,**extra},headers=WRITE)
            assert response.status_code==200
            assert response.json()["invite_required"] is False
            users.append(response.json()["user"]["id"])
            browser.headers.update({**WRITE,"X-LearnAI-Account":users[-1]})
        assert users[0]!=users[1]
        saved=a.post("/api/v1/learner-graph/operations",json=mutation(a,"open registration private note"))
        assert saved.status_code==200
        assert b.get("/api/v1/learner-graph").json()["revision"]==0
        assert "open registration private note" not in b.get("/api/v1/learner-graph").text
        assert b.get("/api/v1/learner-graph",headers={"X-LearnAI-Account":users[0]}).status_code==401
        assert a.post("/api/v1/auth/logout",json={}).status_code==200
        assert a.get("/api/v1/learner-graph").status_code==401
        assert a.post("/api/v1/auth/login",json={"username":"alice","password":PASSWORD},headers=WRITE).status_code==200
        assert a.get("/api/v1/learner-graph").json()["revision"]==saved.json()["revision"]


def test_open_registration_still_rejects_invalid_input_and_duplicate_names(client,monkeypatch):
    monkeypatch.setenv("LEARN_OPEN_REGISTRATION","1")
    app=create_app(client.app.state.engine,allow_local_demo=False)
    with TestClient(app,base_url="https://testserver") as browser:
        app.state.web_origin="https://testserver"
        for extra in [{"password":"short"},{"password":" "*12},{"owner":"local-demo"}]:
            response=browser.post("/api/v1/auth/register",json={"username":"alice","password":PASSWORD,**extra},headers=WRITE)
            assert response.status_code==422
        assert browser.post("/api/v1/auth/register",json={"username":"alice","password":PASSWORD},headers={**WRITE,"Origin":"https://evil.example"}).status_code==403
        assert browser.post("/api/v1/auth/register",json={"username":"alice","password":PASSWORD},headers=WRITE).status_code==200
        assert browser.post("/api/v1/auth/register",json={"username":"Alice","password":PASSWORD},headers=WRITE).status_code==409


def test_invalid_invite_password_and_owner_fields_are_rejected(pair):
    a,_=pair
    assert a.post("/api/v1/auth/register",json={"username":"alice","password":PASSWORD},headers=WRITE).status_code==403
    assert register(a,"alice",invitation(a.app,expired=True)).status_code==403
    assert a.post("/api/v1/auth/register",json={"username":"alice","password":PASSWORD,"owner":"local-demo"},headers=WRITE).status_code==422
    assert a.post("/api/v1/auth/register",json={"username":"alice","password":"short"},headers=WRITE).status_code==422


def test_concurrent_invite_redemption_creates_exactly_one_account(pair):
    a,b=pair;code=invitation(a.app)
    with ThreadPoolExecutor(2) as pool:responses=list(pool.map(lambda item:register(item[0],item[1],code),[(a,"alice"),(b,"bob")]))
    assert sorted(r.status_code for r in responses)==[200,403]


def test_graph_versions_and_operation_keys_are_scoped_to_each_account(pair):
    a,b=pair;assert register(a,"alice").status_code==200 and register(b,"bob").status_code==200
    key=str(uuid4());base_a=a.get("/api/v1/learner-graph").json();base_b=b.get("/api/v1/learner-graph").json()
    for browser,base,note in [(a,base_a,"Alice private note"),(b,base_b,"Bob private note")]:
        base["payload"]["nodes"][0]["data"]["note"]=note
        response=browser.post("/api/v1/learner-graph/operations",json={"base_revision":0,"operation_key":key,"payload":base["payload"],"note":note})
        assert response.status_code==200
    assert a.get("/api/v1/learner-graph/versions/1").json()["note"]=="Alice private note"
    assert b.get("/api/v1/learner-graph?owner=alice").json()["note"]=="Bob private note"
    a.post("/api/v1/learner-graph/restore",json={"base_revision":1,"operation_key":str(uuid4()),"revision":0})
    assert b.get("/api/v1/learner-graph/versions/2").status_code==404


def test_discoveries_routes_and_verification_history_do_not_cross_accounts(pair):
    a,b=pair;register(a,"alice");register(b,"bob");advanced(a,"alice")
    assert a.get("/api/v1/discoveries").json()["entities"] and b.get("/api/v1/discoveries").json()["entities"]==[]
    assert a.get("/api/v1/adventure").json()["stage"]==3 and b.get("/api/v1/adventure").json()["stage"]==0
    assert a.get("/api/v1/guidance").json()["target"]["id"]!="mask" and b.get("/api/v1/guidance").json()["target"]["id"]=="mask"
    state=post_action(a,a.get("/api/v1/verification").json(),"start",goal="mask").json();identity=state["active"]["id"]
    assert post_action(a,state,"submit",attempt_id=identity,choice=0,explanation="固定读取范围，不从未来位置传入信息。").status_code==200
    assert b.get("/api/v1/verification").json()["reports"]==[]
    assert b.get("/api/v1/verification/attempts/"+identity).status_code==404
    assert b.get("/api/v1/candidates?source_id="+identity).json()["items"]==[]
    assert post_action(b,b.get("/api/v1/verification").json(),"self_review",attempt_id=identity).status_code==404
    assert b.get("/api/v1/relation-revisions/"+identity).status_code==404


def test_reviewer_key_only_sees_its_assigned_learner(pair):
    a,b=pair;register(a,"alice");register(b,"bob");advanced(a,"alice")
    state=post_action(a,a.get("/api/v1/verification").json(),"start",goal="mask").json();identity=state["active"]["id"]
    post_action(a,state,"submit",attempt_id=identity,choice=0,explanation="固定范围后检查影响路径。")
    with a.app.state.sessions() as session,session.begin():
        for name in ["alice","bob"]:session.add(ReviewActor(id="review-"+name,name=name,token_hash=digest("fixture-review-"+name),learner_id=session.scalar(select(Account.graph_id).where(Account.username==name)),enabled=1))
    assert a.get("/api/v1/reviewing/"+identity,headers={"Authorization":"Bearer fixture-review-bob"}).status_code==404
    assert b.get("/api/v1/reviewing/"+identity,headers={"Authorization":"Bearer fixture-review-alice"}).status_code==200
    assert a.get("/api/v1/reviewing").status_code==401


def test_logout_expiry_disabled_account_and_old_tab_guard(pair):
    a,b=pair;register(a,"alice");register(b,"bob")
    before=b.get("/api/v1/learner-graph").json()
    assert b.get("/api/v1/learner-graph",headers={"X-LearnAI-Account":a.headers["X-LearnAI-Account"]}).status_code==401
    body={"base_revision":0,"operation_key":str(uuid4()),"payload":before["payload"],"note":"should not save"}
    assert b.post("/api/v1/learner-graph/operations",json=body,headers={"X-LearnAI-Account":a.headers["X-LearnAI-Account"]}).status_code==401
    assert b.post("/api/v1/learner-graph/operations",json=body,headers={"Origin":"https://evil.example"}).status_code==403
    old=a.cookies.get(COOKIE);assert a.post("/api/v1/auth/logout",json={}).status_code==200
    a.cookies.set(COOKIE,old);assert a.get("/api/v1/adventure").status_code==401
    with b.app.state.sessions() as session,session.begin():session.get(AuthSession,digest(b.cookies.get(COOKIE))).expires_at=now()-timedelta(seconds=1)
    assert b.get("/api/v1/adventure").status_code==401
    a.cookies.clear();assert a.post("/api/v1/auth/login",json={"username":"alice","password":PASSWORD},headers=WRITE).status_code==200
    with a.app.state.sessions() as session,session.begin():session.scalar(select(Account).where(Account.username=="alice")).enabled=0
    assert a.get("/api/v1/adventure").status_code==401


def test_login_rate_limit_and_generic_failure(pair,monkeypatch):
    a,_=pair;register(a,"alice");a.cookies.clear()
    for _ in range(5):assert a.post("/api/v1/auth/login",json={"username":"alice","password":"wrong-password-123"},headers=WRITE).status_code==401
    assert a.post("/api/v1/auth/login",json={"username":"alice","password":PASSWORD},headers=WRITE).status_code==429
    tick=auth.monotonic();monkeypatch.setattr(auth,"monotonic",lambda:tick+301)
    assert a.post("/api/v1/auth/login",json={"username":"alice","password":PASSWORD},headers=WRITE).status_code==200


def test_old_demo_is_not_given_to_first_registrant_and_claim_preserves_history(client,pair):
    legacy=client.post("/api/v1/learner-graph/operations",json=mutation(client,"legacy private graph")).json()
    a,b=pair;register(a,"alice");register(b,"bob")
    assert a.get("/api/v1/learner-graph").json()["revision"]==0
    with a.app.state.sessions() as session,session.begin():
        assert claim_demo(session,"alice")["status"]=="ready"
        assert session.scalar(select(Account.graph_id).where(Account.username=="alice"))!="local-demo"
        assert claim_demo(session,"alice",True)["status"]=="claimed"
    assert a.get("/api/v1/adventure").status_code==401
    assert a.post("/api/v1/auth/login",json={"username":"alice","password":PASSWORD},headers=WRITE).status_code==200
    assert a.get("/api/v1/learner-graph").json()==legacy
    assert client.get("/api/v1/learner-graph").status_code==401
    assert "legacy private graph" not in str(b.get("/api/v1/learner-graph").json())
    with a.app.state.sessions() as session,session.begin():
        assert claim_demo(session,"alice",True)["status"]=="already_claimed"
        with pytest.raises(ValueError):claim_demo(session,"bob",True)


def test_claim_refuses_to_overwrite_new_account_progress(pair):
    a,_=pair;register(a,"alice")
    with a.app.state.sessions() as session,session.begin():
        account=session.scalar(select(Account).where(Account.username=="alice"));session.get(AdventureSession,account.graph_id).revision=1
    with a.app.state.sessions() as session,session.begin():
        with pytest.raises(ValueError):claim_demo(session,"alice",True)
