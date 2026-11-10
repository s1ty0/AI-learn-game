"""Offline maintenance. Passwords/invites never enter CLI arguments or source files."""
import argparse
import os
from datetime import timedelta
from getpass import getpass
from pathlib import Path
import secrets
import socket

from sqlalchemy import delete,select

from .auth import digest,password_hash
from .content import DEMO_GRAPH,ROOT
from .db import engine_for,session_factory
from .models import Account,AuthInvite,AuthSession,LearnerGraph,AdventureSession,IntakeSession,GuidanceSession,VerificationSession,Attempt,now


def claim_demo(session,username,apply=False):
    account=session.scalar(select(Account).where(Account.username==username.lower()).with_for_update())
    if not account:raise ValueError("账号不存在；请先在页面创建账号。")
    if account.graph_id==DEMO_GRAPH:return {"status":"already_claimed","username":account.username}
    old=session.get(LearnerGraph,DEMO_GRAPH,with_for_update=True)
    if session.scalar(select(Account.id).where(Account.graph_id==DEMO_GRAPH)):raise ValueError("旧档案已有归属，不能转给其他账号。")
    fresh=session.get(LearnerGraph,account.graph_id,with_for_update=True)
    if not old or not fresh:raise ValueError("档案缺失，先检查备份与迁移。")
    progressed=fresh.revision>0 or session.scalar(select(AdventureSession.id).where((AdventureSession.id==account.graph_id)|(AdventureSession.id.startswith(account.graph_id+":")),AdventureSession.revision>0)) or session.scalar(select(Attempt.id).where(Attempt.owner==account.graph_id))
    for model in (IntakeSession,GuidanceSession,VerificationSession):
        row=session.get(model,account.graph_id)
        progressed=progressed or (row is not None and row.revision>0)
    if progressed:raise ValueError("新账号已有学习记录，不能覆盖或自动合并；保留两边后另行设计迁移。")
    result={"status":"ready" if not apply else "claimed","username":account.username,"previous_graph":account.graph_id,"legacy_revision":old.revision}
    if apply:
        account.previous_graph_id=account.graph_id;account.graph_id=DEMO_GRAPH;account.legacy_claimed_at=now();old.owner=account.id
        session.execute(delete(AuthSession).where(AuthSession.account_id==account.id))
    return result


def main():
    parser=argparse.ArgumentParser(description="账号维护：邀请码只写忽略目录，旧档案归属默认仅预检。")
    parser.add_argument("action",choices=["invite","claim-demo","reset-password","disable"])
    parser.add_argument("username",nargs="?")
    parser.add_argument("--apply",action="store_true")
    parser.add_argument("--server-stopped",action="store_true")
    args=parser.parse_args()
    if args.action!="invite" and not args.username:parser.error("需要指定账号用户名。")
    if args.action=="claim-demo" and args.apply:
        if not args.server_stopped:parser.error("实际迁移须先停止Web/API并传--server-stopped；先备份数据库。")
        with socket.socket() as probe:
            probe.settimeout(.5)
            if probe.connect_ex(("127.0.0.1",int(os.environ.get("LEARN_API_PORT","8000"))))==0:parser.error("本机API端口仍在使用，请核对LEARN_API_PORT与运行进程。")
    engine=engine_for()
    try:
        with session_factory(engine)() as session,session.begin():
            if args.action=="invite":
                folder=ROOT/".runtime"/"invite-keys"
                if folder.is_symlink() or folder.parent.is_symlink():raise ValueError("凭据目录异常，未写入。")
                folder.mkdir(parents=True,exist_ok=True)
                code=secrets.token_urlsafe(32);identity=secrets.token_hex(8);path=folder/(identity+".txt")
                with path.open("x",encoding="utf-8") as output:output.write(code+"\n")
                session.add(AuthInvite(token_hash=digest(code),expires_at=now()+timedelta(days=7)))
                print(f"一次性邀请码写入：{path}；7天内有效，不提交Git。")
            elif args.action=="claim-demo":print(claim_demo(session,args.username,args.apply))
            else:
                account=session.scalar(select(Account).where(Account.username==args.username.lower()).with_for_update())
                if not account:raise ValueError("未找到账号。")
                if args.action=="disable":
                    if not args.apply:raise ValueError("停用账号需要--apply，不删除学习记录。")
                    account.enabled=0
                else:
                    password=getpass("新密码（12至128字符，不回显）：")
                    if not 12<=len(password)<=128 or not password.strip() or password!=getpass("再次输入："):raise ValueError("密码长度或两次输入不一致。")
                    account.password_hash=password_hash(password)
                session.execute(delete(AuthSession).where(AuthSession.account_id==account.id))
                print("账号已更新，现有登录已失效，学习记录保留。")
    except ValueError as error:print(str(error));raise SystemExit(1)
    finally:engine.dispose()


if __name__=="__main__":main()
