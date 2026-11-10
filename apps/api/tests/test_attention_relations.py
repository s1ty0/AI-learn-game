from datetime import datetime,timedelta
from fractions import Fraction
import json

import pytest

from app import candidates
from app.models import AdventureSession
from app.chapter import session_id
from app.relation_tasks import TEMPLATES
from test_learning_loop import client
from test_relation_evidence import save,start_bound
from test_relation_revisions import task,payload,post
from test_revision_challenges import start as challenge_start,preview
from test_verification import act
from test_candidates import approve
from test_reviewing import actor


def prepare(client,template):
    definition=TEMPLATES[template]
    with client.app.state.sessions() as session,session.begin():
        for node in ["mask","prism",*( ["query"] if template=="causal-attention" else [])]:
            session.get(AdventureSession,session_id(node)).stage=3
    graph=client.get("/api/v1/learner-graph").json()
    for i,entity in enumerate([definition["source"],definition["target"]]):
        if not any(n["id"]==entity for n in graph["payload"]["nodes"]):graph["payload"]["nodes"].append({"id":entity,"type":"knowledge","position":{"x":200*i,"y":0},"data":{"label":entity,"note":"我的解释"}})
    graph["payload"]["edges"].append({"id":"my-relation","source":definition["source"],"target":definition["target"],"label":"我写的关系仍需检查","note":"先看具体条件，不直接推广。"})
    return save(client,graph["payload"])


def submit(client,state,choice=0,helped=False):
    response=act(client,state,"submit",attempt_id=state["active"]["id"],choice=choice,explanation="固定允许集合后，先归一化再相乘相加；还需检查上游路径和命题边界。",used_help=helped)
    assert response.status_code==200
    return response.json()["reports"][-1]


def repaired(client,template):
    graph=prepare(client,template);report=submit(client,start_bound(client,graph,template).json())
    body=payload(task(client,report));body.update(criteria=["path","conditions","boundary"],
        label="先确定允许集合，归一化权重，再汇聚V",note="本次局部计算无dropout或投影；上游和其他路径需分别检查。")
    response=post(client,report,body);assert response.status_code==200
    return response.json(),report


@pytest.mark.parametrize("template",["softmax-aggregation","causal-attention"])
def test_new_binding_is_discovered_directional_and_has_dedicated_situation(client,template):
    graph=prepare(client,template)
    info=client.get("/api/v1/relation-evidence/my-relation").json()
    assert [t["id"] for t in info["templates"]]==[template]
    state=start_bound(client,graph,template).json()
    assert "分数" in state["active"]["prompt"] and "我写的关系" in state["active"]["prompt"]
    assert "rationale" not in state["active"] and not state["active"]["support_available"]
    report=submit(client,state)
    assert report["choice_matches"]
    assert ("分母" if template=="causal-attention" else "1/4") in report["rationale"]
    assert client.get("/api/v1/star-evidence/"+TEMPLATES[template]["target"]).json()["items"]==[]


@pytest.mark.parametrize("template",["softmax-aggregation","causal-attention"])
def test_new_directions_and_discovery_are_not_inferred_from_names(client,template):
    graph=prepare(client,template);edge=graph["payload"]["edges"][-1]
    edge["source"],edge["target"]=edge["target"],edge["source"];graph=save(client,graph["payload"])
    assert start_bound(client,graph,template).status_code==422
    edge=graph["payload"]["edges"][-1]
    edge["source"],edge["target"]=edge["target"],edge["source"];graph=save(client,graph["payload"])
    with client.app.state.sessions() as session,session.begin():session.get(AdventureSession,"local-demo:"+("prism" if template=="softmax-aggregation" else "query")).stage=0
    assert start_bound(client,graph,template).status_code==409


@pytest.mark.parametrize("template,choice",[("softmax-aggregation",2),("causal-attention",0)])
def test_bound_recheck_uses_its_own_structural_variant(client,monkeypatch,template,choice):
    graph=prepare(client,template);source=submit(client,start_bound(client,graph,template).json());approve(client,source,[actor(client,"alice"),actor(client,"bob")])
    monkeypatch.setattr(candidates,"now",lambda:datetime.fromisoformat(source["created_at"])+timedelta(hours=72))
    item=client.get("/api/v1/candidates?source_id="+source["id"]).json()["items"][0]
    state=client.get("/api/v1/verification").json()
    response=act(client,state,"start_recheck",parent_attempt=source["id"],parent_review_revision=item["initial"]["review_revision"])
    assert response.status_code==200
    report=submit(client,response.json(),choice)
    assert report["choice_matches"] and report["binding"]["edge"]==source["binding"]["edge"]
    assert report["prompt"]!=source["prompt"] and report["task_version"]!=source["task_version"]


@pytest.mark.parametrize("template,focus,choice",[("softmax-aggregation","path",0),("softmax-aggregation","conditions",1),("softmax-aggregation","boundary",0),("causal-attention","path",1),("causal-attention","conditions",0),("causal-attention","boundary",1)])
def test_six_attention_repair_challenges_keep_scoped_feedback_and_candidate_isolation(client,template,focus,choice):
    repair,source=repaired(client,template);assert preview(client,repair).status_code==200
    state=challenge_start(client,repair,focus).json()
    assert state["active"]["support_available"] and "support" not in state["active"]
    report=submit(client,state,choice)
    assert report["target_feedback"]["selection"]=="matches" and report["target_feedback"]["gap_status"]=="not_established"
    assert report["binding"]["edge"]==repair["after"] and report["revision_origin"]["source_attempt"]==source["id"]
    assert client.get("/api/v1/candidates?source_id="+report["id"]).json()["items"]==[]


@pytest.mark.parametrize("template",["softmax-aggregation","causal-attention"])
def test_support_is_idempotent_persistent_and_cannot_be_unmarked_on_submit(client,template):
    repair,_=repaired(client,template);state=challenge_start(client,repair).json();attempt=state["active"]["id"]
    response=act(client,state,"support",attempt_id=attempt);assert response.status_code==200
    supported=response.json();assert supported["active"]["help_used"] and supported["active"]["support"]["kind"] in {"mask","weights"}
    assert client.post("/api/v1/verification/actions",json=json.loads(response.request.content)).json()==supported
    assert act(client,supported,"support",attempt_id=attempt).status_code==409
    loaded=client.get("/api/v1/verification").json();assert loaded["active"]["help_used"]
    report=submit(client,loaded,helped=False)
    assert report["used_help"] and report["independence"]=="supported" and report["help_used"]
    assert client.get("/api/v1/verification/attempts/"+attempt).json()["support"]==loaded["active"]["support"]
    assert act(client,client.get("/api/v1/verification").json(),"support",attempt_id=attempt).status_code==409


def test_support_cannot_be_forged_for_uncovered_or_other_attempt(client):
    from test_revision_challenges import saved
    repair,_=saved(client);state=challenge_start(client,repair).json()
    assert act(client,state,"support",attempt_id=state["active"]["id"]).status_code==422
    assert act(client,state,"support",attempt_id="invented").status_code==404


def test_attention_numbers_against_independent_fraction_reference():
    def mix(exponents,values,allowed):
        total=sum(exponents[i] for i in allowed)
        return sum(Fraction(exponents[i],total)*values[i] for i in allowed)
    assert mix([1,3],[-2,6],[0,1])==4
    assert mix([3,1],[-4,8],[0,1])==-1
    assert mix([3,1],[0,10],[0,1])==Fraction(5,2)
    assert mix([1,3],[-8,4],[0,1])==1
    assert mix([1,3,6],[2,6,100],[0,1])==5
    assert mix([2,1,7],[-3,9,100],[0,1])==1
    assert mix([2,1,7],[-3,9,100],[0,1,2])==Fraction(703,10)
    assert mix([1,1,2],[2,6,100],[0,1])==4
    assert mix([1,1],[4,0],[0,1])==2 and mix([1,1],[12,0],[0,1])==6
    assert mix([2,2],[0,8],[0,1])==mix([10,10],[0,8],[0,1])==4
    assert mix([10,10],[0,12],[0,1])==6
    assert mix([1,1,1],[2,8,20],[0,1])==5 and mix([1,1,1],[2,8,20],[0,1,2])==10
