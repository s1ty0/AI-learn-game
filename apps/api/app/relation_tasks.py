"""Explicit task templates for player propositions; endpoints alone never certify."""
from copy import deepcopy
from .verification_content import TASKS
from .recheck_content import RECHECK_TASKS
from .attention_relation_content import INITIAL,RECHECK

TEMPLATES={
 "lookup-map":{"title":"编号与嵌入查表关系","source":"entity-0144","target":"entity-0073","goal":"lookup"},
 "mse-example":{"title":"均方误差作为损失选择","source":"entity-0138","target":"entity-0014","goal":"loss"},
 "softmax-aggregation":{"title":"Softmax与加权汇聚","source":"entity-0142","target":"entity-0147","goal":"weights"},
 "causal-attention":{"title":"因果掩码与注意力读取","source":"entity-0068","target":"entity-0143","goal":"mask"},
}


def signature(edge):
    return {k:edge.get(k,"") for k in ("id","source","target","label","note")}


def task_for(template,binding,recheck=False):
    definition=TEMPLATES[template]
    task=deepcopy((RECHECK_TASKS if recheck else TASKS)[definition["goal"]])
    content=(RECHECK if recheck else INITIAL).get(template)
    if content:
        task.update({k:deepcopy(v) for k,v in content.items() if k!="requirements"})
        for c,r in zip(task["criteria"],content["requirements"]):c["requirement"]=r
    task["family"]="relation-"+template+("-retention" if recheck else "-transfer")+"-v1"
    task["title"]="关系复验："+definition["title"] if recheck else "关系验证："+definition["title"]
    task["prompt"]=("以下是你保存的个人关系原文，可能正确也可能存在误解，不是标准答案。\n"
        +"命题："+binding["edge"]["label"]+"\n理由与条件："+binding["edge"]["note"]
        +"\n先解决下面的新情境，再明确检查这条原命题：哪些成立、哪些需要纠正？不要只解释两个术语。\n"+task["prompt"])
    task["criteria"][0]["requirement"]+=" 同时核对个人原命题本身是否支持正确推导；原命题有误时需指出并改正，但即便新题答对或解释已纠正，此条也应标部分满足/缺失，不能用纠正后的命题认证原连线。"
    task["criteria"][1]["requirement"]+=" 对照原关系中的理由与条件，指出缺失或过度推广。"
    task["criteria"][2]["requirement"]+=" 明确给出这条关系的适用边界或反例，不把端点证据当关系证据。"
    return task
