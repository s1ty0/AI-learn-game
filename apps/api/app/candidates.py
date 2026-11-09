"""Read-only candidate projection. Recorded observations are claims, not proof."""
from datetime import datetime,timedelta
from fastapi import APIRouter,Request,HTTPException

from .content import DEMO_GRAPH
from .models import ReviewCase,VerificationSession,now
from .reviewing import projection

router=APIRouter(prefix="/api/v1/candidates")
POLICY="candidate-v1-72h"
INTERVAL=timedelta(hours=72)


def admission(session,start,answer):
    case=session.get(ReviewCase,start["attempt_id"])
    summary=projection(case,answer["choice_matches"])
    latest={e["actor"]:e for e in case.events} if case else {}
    observations=[e.get("observation",{"judgement":"not_established","basis":""}) for e in latest.values()]
    checks=[
      {"id":"prediction","ok":answer["choice_matches"] is True,"label":"本题判断符合规则"},
      {"id":"help","ok":not answer["used_help"],"label":"作答未标记使用帮助"},
      {"id":"family","ok":not start["repeat_family"],"label":"不是同题族重做"},
      {"id":"reviewers","ok":summary["reviewer_count"]>=2,"label":"至少两个配置身份逐项复核"},
      {"id":"criteria","ok":summary["status"]=="consistent_review","label":"逐项全满足且没有当前分歧"},
      {"id":"observation","ok":any(o["judgement"]=="observed_no_help" and o["basis"].strip() for o in observations) and not any(o["judgement"]=="assisted" for o in observations),"label":"有复核者记录无帮助观察依据，且没有帮助观察冲突"},
    ]
    return {"eligible":all(c["ok"] for c in checks),"checks":checks,"review_revision":summary["revision"],"review_status":summary["status"]}


def ledger(session,offset=0,source_id=None,goals=None,page_size=50):
    clock=now()
    row=session.get(VerificationSession,DEMO_GRAPH)
    events=row.events if row else []
    starts=[e for e in events if e["action"]=="start"]
    answers={e["attempt_id"]:e for e in events if e["action"]=="submit"}
    items=[]
    for source in starts:
        if source.get("kind")=="recheck" or source["attempt_id"] not in answers:continue
        if source_id is not None and source["attempt_id"]!=source_id:continue
        if goals is not None and source["goal"] not in goals:continue
        answer=answers[source["attempt_id"]]
        initial=admission(session,source,answer)
        due=datetime.fromisoformat(answer["created_at"])+INTERVAL
        children=[s for s in starts if s.get("parent_attempt")==source["attempt_id"]]
        active=next((s for s in children if s["attempt_id"] not in answers),None)
        child=children[-1] if children else None
        child_admission=admission(session,child,answers[child["attempt_id"]]) if child and child["attempt_id"] in answers else None
        status="needs_evidence"
        reason="先补齐下面的初次验证证据；本人复盘或复核人数不能代替独立性观察。"
        if initial["eligible"]:
            if active:status="recheck_in_progress";reason="复验已开始，回验证室继续。来源复核变化仍会重新检查。"
            elif child_admission:
                if child.get("evidence_policy")!=POLICY or datetime.fromisoformat(child["created_at"])<due:status="needs_policy_review";reason="复验规则版本或间隔时间需明确核对，不能静默认证。"
                elif child_admission["eligible"]:status="candidate_ready";reason="当前记录满足本版候选条件；仍不等于永久掌握，也不自动解锁。"
                else:status="recheck_needs_evidence";reason="复验还缺证据。错误、帮助和同题重做不能靠多刷一次清除。"
            elif clock<due:status="waiting_interval";reason="初次记录条件已齐，等服务器计时满72小时后做新情境复验。"
            else:status="ready_for_recheck";reason="已到复验时间。先独立尝试新情境，再对照量规与复核。"
        items.append({"id":source["attempt_id"],"goal":source["goal"],"title":source["task"]["title"],"status":status,"reason":reason,"due_at":due.isoformat(),
                      "initial":initial,"recheck":child_admission,"active_recheck":active["attempt_id"] if active else None,
                      "recheck_attempt":child["attempt_id"] if child else None,"mastery":"unverified"})
    end=max(0,len(items)-offset);begin=max(0,end-page_size) if page_size is not None else 0
    return {"policy":POLICY,"server_time":clock.isoformat(),"interval_hours":72,"items":items[begin:end],"total":len(items),"next_offset":offset+page_size if begin>0 else None,"mastery":"unverified"}


@router.get("")
def current(request:Request,offset:int=0,source_id:str|None=None):
    if not 0<=offset<=10000:raise HTTPException(422,"候选记录位置超出范围。")
    if source_id is not None and not 1<=len(source_id)<=100:raise HTTPException(422,"来源ID无效。")
    with request.app.state.sessions() as session:return ledger(session,offset=offset,source_id=source_id)
