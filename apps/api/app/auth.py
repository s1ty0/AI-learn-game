"""Opaque server sessions and explicit learner scopes. No browser owner identifiers."""
from collections import defaultdict,deque
from datetime import timedelta
import hashlib
import hmac
import os
import secrets
from threading import BoundedSemaphore,Lock
from time import monotonic
from uuid import uuid4

from fastapi import APIRouter,HTTPException,Request,Response
from pydantic import BaseModel,ConfigDict,Field
from sqlalchemy import delete,select
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from .content import DEMO_GRAPH,seed_learner
from .models import Account,AuthSession,AuthInvite,ReviewActor,now
from .learner_context import current_graph

router=APIRouter(prefix="/api/v1/auth")
COOKIE="learnai_session"
LIFETIME=timedelta(days=7)
HASH_SLOTS=BoundedSemaphore(2)


def digest(token):return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password,salt=None):
    salt=salt or secrets.token_hex(16)
    if not HASH_SLOTS.acquire(blocking=False):raise HTTPException(429,"登录计算繁忙，请稍后重试。")
    try:result=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=2**17,r=8,p=1,maxmem=256*1024*1024,dklen=32).hex()
    finally:HASH_SLOTS.release()
    return f"scrypt$131072$8$1${salt}${result}"


def password_matches(password,encoded):
    try:
        prefix,n,r,p,salt,_=encoded.split("$")
        if (prefix,n,r,p)!=("scrypt","131072","8","1"):return False
        return hmac.compare_digest(password_hash(password,salt),encoded)
    except (ValueError,TypeError):return False


DUMMY_HASH=password_hash("invalid-account-timing-padding")


class Credentials(BaseModel):
    model_config=ConfigDict(extra="forbid")
    username:str=Field(min_length=3,max_length=40,pattern=r"^[A-Za-z0-9_-]+$")
    password:str=Field(min_length=12,max_length=128)
    invite:str=Field(default="",max_length=200)


def public_user(account):return {"id":account.id,"username":account.username}


def demo_available(session,app):
    return app.state.allow_local_demo and session.scalar(select(Account.id).where(Account.graph_id==DEMO_GRAPH)) is None


def browser_write(request):
    if request.headers.get("x-learnai-request")!="1":raise HTTPException(403,"请求来源校验未通过，请刷新当前页面。")
    origin=request.headers.get("origin")
    allowed=request.app.state.web_origin
    local={"http://127.0.0.1:3000","http://localhost:3000"} if request.app.state.allow_local_demo else set()
    if origin and origin not in {allowed,*local}:raise HTTPException(403,"请求来源不匹配。")


def throttle(request,username):
    state=request.app.state
    with state.auth_limit_lock:
        tick=monotonic()
        if len(state.auth_limits)>=2048:
            for key in [k for k,q in state.auth_limits.items() if not q or tick-q[-1]>300]:
                del state.auth_limits[key]
        keys=[("ip:"+(request.client.host if request.client else "unknown"),30),("user:"+username,6)]
        if len(state.auth_limits)+sum(key not in state.auth_limits for key,_ in keys)>2048:
            raise HTTPException(429,"尝试过于频繁，请稍后重试。",headers={"Retry-After":"300"})
        for key,limit in keys:
            queue=state.auth_limits[key]
            while queue and tick-queue[0]>300:queue.popleft()
            if len(queue)>=limit:raise HTTPException(429,"尝试过于频繁，请5分钟后再试。",headers={"Retry-After":"300"})
        for key,_ in keys:state.auth_limits[key].append(tick)


def session_account(session,token):
    if not token or len(token)>200:return None
    entry=session.get(AuthSession,digest(token))
    if not entry or entry.expires_at<=now():return None
    account=session.get(Account,entry.account_id)
    return account if account and account.enabled else None


def issue(session,account,request,response):
    old=request.cookies.get(COOKIE)
    if old:session.execute(delete(AuthSession).where(AuthSession.token_hash==digest(old)))
    token=secrets.token_urlsafe(32)
    session.add(AuthSession(token_hash=digest(token),account_id=account.id,expires_at=now()+LIFETIME))
    response.set_cookie(COOKIE,token,max_age=int(LIFETIME.total_seconds()),httponly=True,secure=not request.app.state.allow_local_demo,samesite="strict",path="/")
    response.headers["Cache-Control"]="no-store"
    return {"user":public_user(account),"mode":"account","demo_available":demo_available(session,request.app),"invite_required":not request.app.state.allow_local_demo}


@router.get("/session")
def whoami(request:Request,response:Response):
    response.headers["Cache-Control"]="no-store"
    with request.app.state.sessions() as session:
        account=session_account(session,request.cookies.get(COOKIE))
        available=demo_available(session,request.app)
        if account:return {"user":public_user(account),"mode":"account","demo_available":available,"invite_required":not request.app.state.allow_local_demo}
        if request.cookies.get(COOKIE):response.delete_cookie(COOKIE,path="/")
        return {"user":None,"mode":"local-demo" if available else "required","demo_available":available,"invite_required":not request.app.state.allow_local_demo}


@router.post("/register")
def register(body:Credentials,request:Request,response:Response):
    browser_write(request);name=body.username.lower();throttle(request,name)
    if not body.password.strip():raise HTTPException(422,"密码不能全为空白。")
    encoded=password_hash(body.password)
    try:
        with request.app.state.sessions() as session,session.begin():
            invitation=None
            if not request.app.state.allow_local_demo:
                invitation=session.scalar(select(AuthInvite).where(AuthInvite.token_hash==digest(body.invite)).with_for_update())
                if not invitation or invitation.used_by or invitation.expires_at<=now():raise HTTPException(403,"邀请码无效、过期或已使用。")
            if session.scalar(select(Account.id).where(Account.username==name)):raise HTTPException(409,"这个用户名已使用，请换一个。")
            identity=str(uuid4());graph_id="learner:"+identity
            seed_learner(session,request.app.state.release_id,graph_id,identity)
            account=Account(id=identity,username=name,password_hash=encoded,graph_id=graph_id)
            session.add(account);session.flush()
            if invitation:invitation.used_by=account.id
            return issue(session,account,request,response)
    except IntegrityError:raise HTTPException(409,"用户名或邀请状态已变化，请重新确认。")


@router.post("/login")
def login(body:Credentials,request:Request,response:Response):
    browser_write(request);name=body.username.lower();throttle(request,name)
    with request.app.state.sessions() as session,session.begin():
        account=session.scalar(select(Account).where(Account.username==name))
        valid=password_matches(body.password,account.password_hash if account else DUMMY_HASH)
        if not valid or not account or not account.enabled:raise HTTPException(401,"用户名或密码不正确，或账号已停用。")
        return issue(session,account,request,response)


@router.post("/logout")
def logout(request:Request,response:Response):
    browser_write(request)
    with request.app.state.sessions() as session,session.begin():
        token=request.cookies.get(COOKIE)
        account=session_account(session,token)
        if account and request.headers.get("x-learnai-account")!=account.id:raise HTTPException(401,"账号已变化，请先重新读取账号状态。")
        if token:session.execute(delete(AuthSession).where(AuthSession.token_hash==digest(token)))
    response.delete_cookie(COOKIE,path="/");response.headers["Cache-Control"]="no-store"
    return {"signed_out":True}


def install(app,allow_local_demo):
    app.state.allow_local_demo=allow_local_demo
    app.state.web_origin=os.environ.get("LEARN_WEB_ORIGIN","http://127.0.0.1:3000" if allow_local_demo else "")
    app.state.auth_limits=defaultdict(deque);app.state.auth_limit_lock=Lock()
    app.include_router(router)

    def resolve(request):
        with app.state.sessions() as session:
            if request.url.path.startswith("/api/v1/reviewing"):
                authorization=request.headers.get("authorization","")
                token=authorization[7:] if authorization.lower().startswith("bearer ") else ""
                actor=session.scalar(select(ReviewActor).where(ReviewActor.token_hash==digest(token),ReviewActor.enabled==1)) if token else None
                if not actor:raise HTTPException(401,"需要有效的复核者访问钥匙。")
                return actor.learner_id
            token=request.cookies.get(COOKIE)
            expected=request.headers.get("x-learnai-account")
            if token:
                account=session_account(session,token)
                if not account:raise HTTPException(401,"登录已过期，请重新登录。")
                if expected is not None and expected!=account.id:
                    raise HTTPException(401,"当前账号已变化，请刷新后继续。")
                if request.method not in {"GET","HEAD","OPTIONS"}:
                    browser_write(request)
                    if expected!=account.id:raise HTTPException(401,"请重新读取当前账号后再提交。")
                return account.graph_id
            if expected is not None and expected!="local-demo":raise HTTPException(401,"登录已结束，请重新登录。")
            if demo_available(session,app):return DEMO_GRAPH
            raise HTTPException(401,"请先登录，再访问自己的学习档案。")

    @app.middleware("http")
    async def identity_scope(request,call_next):
        path=request.url.path
        public=path in {"/api/v1/health","/api/v1/content","/api/v1/lesson"} or path.startswith("/api/v1/auth/")
        if not path.startswith("/api/v1/") or public:return await call_next(request)
        from starlette.responses import JSONResponse
        try:graph_id=await run_in_threadpool(resolve,request)
        except HTTPException as error:return JSONResponse({"detail":error.detail},status_code=error.status_code,headers={"Cache-Control":"no-store",**(error.headers or {})})
        scope=current_graph.set(graph_id)
        try:response=await call_next(request)
        finally:current_graph.reset(scope)
        response.headers["Cache-Control"]="no-store"
        return response
