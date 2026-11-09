"""Local operator CLI. Never prints reviewer bearer keys."""
import argparse
import hashlib
from pathlib import Path
import re
import secrets

from .db import engine_for, session_factory
from .models import ReviewActor

ROOT=Path(__file__).resolve().parents[3]


def main():
    parser=argparse.ArgumentParser(description="本机复核者访问权限管理，不输出钥匙内容。")
    parser.add_argument("action",choices=["create","rotate","revoke"])
    parser.add_argument("id")
    parser.add_argument("name",nargs="?")
    args=parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9_-]{2,39}",args.id) or args.id=="local-demo":
        parser.error("ID须为3至40位小写字母/数字/下划线/短横线，且不能是学习者ID。")
    if args.action=="create" and (not args.name or not args.name.strip() or len(args.name)>80):parser.error("创建时需提供1至80字符的真实复核者显示名。")
    runtime=ROOT/".runtime"
    destination=runtime/"reviewer-keys"
    if runtime.is_symlink() or destination.is_symlink():parser.error("凭据目录不能是符号链接，未写入。")
    folder=destination.resolve()
    path=folder/f"{args.id}.txt"
    if ROOT.resolve() not in folder.parents or path.is_symlink() or (path.exists() and (not path.is_file() or path.stat().st_nlink!=1)):parser.error("凭据目录或文件路径异常，未写入。")
    engine=engine_for()
    try:
        with session_factory(engine)() as session,session.begin():
            actor=session.get(ReviewActor,args.id,with_for_update=True)
            if args.action=="create":
                if actor or path.exists():raise ValueError("该ID或凭据文件已存在，未覆盖；需要换钥匙时用rotate。")
                actor=ReviewActor(id=args.id,name=args.name.strip(),token_hash="",enabled=1);session.add(actor)
            elif not actor:raise ValueError("未找到这个复核者ID。")
            if args.action=="revoke":actor.enabled=0;token=None
            else:
                token=secrets.token_urlsafe(32)
                actor.token_hash=hashlib.sha256(token.encode()).hexdigest();actor.enabled=1
        if token:
            folder.mkdir(parents=True,exist_ok=True)
            with path.open("w" if args.action=="rotate" else "x",encoding="utf-8") as output:output.write(token+"\n")
            print(f"钥匙仅写入本机忽略目录：{path}；界面手动粘贴使用，不提交Git。")
        else:print("访问权限已停用；历史复核保持，旧凭据文件不自动删除。")
    except ValueError as error:print(str(error));raise SystemExit(1)
    except Exception:
        print("操作未完成。请确认数据库/迁移就绪；若权限已更新而文件未写入，可用rotate重新生成。未输出凭据。")
        raise SystemExit(1)
    finally:engine.dispose()


if __name__=="__main__":main()
