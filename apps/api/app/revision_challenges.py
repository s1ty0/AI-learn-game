"""Small, fixed practice families for a saved repair, separate from certification."""
from copy import deepcopy

from fastapi import HTTPException

from .relation_evidence import binding_for, current_edge
from .relation_tasks import signature, TEMPLATES
from .verification_content import TASKS
from .attention_relation_content import SUPPORT,CHALLENGE_REQUIREMENTS

FOCI={"path":"检查推导","conditions":"检查条件","boundary":"检查边界"}
# Each family has its own situation. Editing a proposition never resets exposure.
SCENARIOS={
 ("softmax-aggregation","path"):(
  "两项分数的指数值为3、1，V为−4、8。无dropout/投影。先归一化再汇聚，结果是多少？别直接把指数值作为权重。",
  ["−1","2","4"],0,"权重为3/4、1/4，输出=0.75×(−4)+0.25×8=−1。指数值之比决定归一化权重，原始指数值3和1本身不是总和为1的权重。"),
 ("softmax-aggregation","conditions"):(
  "V固定为0、10，分数指数值原为1、1，输出5。只增加第一个分数，使指数值变成3、1。无dropout/投影。新输出是多少？是否能套用原先的1/2权重？",
  ["仍为5，因为V没变","变为2.5，需重新计算权重","变为10"],1,"新权重3/4、1/4，输出0.75×0+0.25×10=2.5。V固定不代表权重固定；相对分数改变后需重算，不能沿用1/2。"),
 ("softmax-aggregation","boundary"):(
  "无dropout/投影的标量汇聚，Softmax权重为1/4、3/4，V为−8、4。输出和能据此得到的结论是哪项？",
  ["输出1，位于[−8,4]内；这不能直接证明某输入的因果重要性","输出4，必定等于最大值","输出−12，所有加权和都能越过原值范围"],0,"输出−2+3=1。非负且和为1的标量权重保证结果位于最小/最大V之间；任意未归一化加权、dropout或后续投影不自动继承这个范围。权重本身不是完整的因果解释。"),
 ("causal-attention","path"):(
  "位置1只读0、1。三项分数指数值2、1、7，V为−3、9、100。先排除位置2再归一化，无其他路径。输出是多少？说明分母用哪些项。",
  ["70.3","1","0.3"],1,"分母只用2+1=3，权重2/3、1/3、0，输出−2+3=1。不能让被排除项的7进入分母，也不能读取它的100。"),
 ("causal-attention","conditions"):(
  "位置1只读0、1。三项指数值1、1、2，V为2、6、100。有人先对三项归一化为1/4、1/4、1/2，再把第三个权重清零，算出2。正确的局部输出是多少？还缺哪一步？",
  ["4，要在允许项上归一化或清零后再归一化","2，清零就完成了因果掩码","100，未来项最大"],0,"允许项的正确权重为1/2、1/2，输出4。先全体归一化再仅清零会留下权重和1/2；需要重新归一化，或在Softmax前排除未来项。"),
 ("causal-attention","boundary"):(
  "位置1本层只读0、1，两项等权。但上游把未来输入x2复制进V0，V1=0。只把x2从4改为12，其他规则固定。本层输出如何？本层掩码能否保证整条计算没有未来泄露？",
  ["始终为2，任何因果掩码都消除所有泄露","从2变为6，仍可经上游V0传入未来信息","从4变为12，等权不需要除以2"],1,"输出从(4+0)/2=2变为(12+0)/2=6。未来信息已由上游进入允许读取的V0；本层只屏蔽直接读取路径，必须检查上游/旁路，不能只凭一个局部掩码保证整个系统因果。"),
 ("lookup-map","path"):(
  "词表中‘风’编号2、‘雨’编号0。嵌入表第0行[4,1]、第1行[-2,3]、第2行[0,5]。输入‘风 雨 风’，只执行查表，结果是什么？解释你实际按什么索引。",
  ["[[4,1],[0,5],[4,1]]","[[0,5],[4,1],[0,5]]","[[2,2],[0,0],[2,2]]"],1,
  "输入编号依次为2、0、2，逐项读取对应行，得到[[0,5],[4,1],[0,5]]。行号选择向量，不把编号本身当向量值。"),
 ("lookup-map","conditions"):(
  "旧词表‘风’=0、‘雨’=1，表行为[[2,7],[-1,4]]。新词表改为‘风’=1、‘雨’=0，要让每个词查得的向量不变，还必须怎么做？这里只考虑查表步骤。",
  ["嵌入表保持原样","给所有表值加1","表行改为[[-1,4],[2,7]]"],2,
  "新编号需要同步交换对应表行。于是‘风’仍取[2,7]、‘雨’仍取[-1,4]。这只保持查表结果，不宣称整个模型经过任何重编号都不变。"),
 ("lookup-map","boundary"):(
  "三个词编号0、1、2，对应向量[1,0]、[-1,0]、[0.9,0]。只看这张表，编号更接近是否必然让向量的欧氏距离更小？比较0到1与0到2，并解释能否据此断言真实语义。",
  ["不必然：两距离分别2和0.1；真实语义仍不能只凭这三行断言","必然：编号差1小于2","只要编号连续，向量就相同"],0,
  "0到1的向量距离为2，0到2为0.1，构成‘编号差保证向量距离’的反例。向量距离也不自动等于任何场景下的真实语义关系。"),
 ("mse-example","path"):(
  "同一组两个样本，模型A误差[-1,5]，模型B误差[3,3]。MSE（均方误差）定义为误差平方的平均值。只按本组MSE，应选哪个模型？给出计算。",
  ["A，因为有一个误差更小","B，A为13、B为9","两者都是9"],1,
  "A的MSE=(1+25)/2=13，B的MSE=(9+9)/2=9，因此按本组MSE选B。不能用平均有符号误差或单个较好样本替代平方平均。"),
 ("mse-example","conditions"):(
  "两组样本的组内MSE分别为1和9，样本数分别为1和3。要计算四个样本等权的整体MSE，应该取哪个值？说明为何不能直接平均组均值。",
  ["5，两个组均值直接平均","10，两个组均值相加","7，按样本数加权"],2,
  "整体平方误差和=1×1+9×3=28，整体MSE=28/4=7。直接平均得到5，会让小组中的每个样本获得更大权重；只有组大小相同等特定条件下才与逐样本等权一致。"),
 ("mse-example","boundary"):(
  "同一评估集两个样本，A误差[0,4]、B误差[3,3]。A的MSE=8，B的MSE=9。哪条结论成立？同时检查‘每个样本更好’与‘未来数据更好’。",
  ["A每个样本都更好，未来也一定更好","只支持A在本评估集的MSE更低；第二个样本A更差，未来表现尚不确定","B在本评估集的MSE更低"],1,
  "A整体MSE更低，但第二个样本的绝对误差4大于3，因此不是逐样本都更好。本评估集更低也不能保证未来数据更低，仍受分布、划分与评估设计等条件影响。"),
}


def context(session,row,revision_id,release_id,graph_revision=None,lock=False):
    repair=next((e for e in (row.events if row else []) if e["action"]=="relation_revision" and e["id"]==revision_id),None)
    if not repair:raise HTTPException(404,"未找到已保存的关系修订，不能为未提交草稿开启挑战。")
    head,_,edge=current_edge(session,repair["after"]["id"],lock=lock)
    if signature(edge)!=repair["after"]:raise HTTPException(409,"当前关系已不等于这次修订。请回修订任务核对，不能用旧修订挑战当前命题。")
    if graph_revision is not None and head.revision!=graph_revision:raise HTTPException(409,"星图版本已变化，请重新读取挑战目标后开始。")
    binding=binding_for(session,release_id,edge["id"],head.revision,repair["binding"]["template"],lock=lock)
    return repair,binding


def task_for(repair,binding,focus):
    if focus not in repair["criteria"] or (binding["template"],focus) not in SCENARIOS:raise HTTPException(422,"只能选择这次修订记录中的一个条目进行挑战。")
    prompt,options,correct,rationale=SCENARIOS[(binding["template"],focus)]
    task=deepcopy(TASKS[TEMPLATES[binding["template"]]["goal"]])
    task.update(family=f"revision-{binding['template']}-{focus}-v1",title="修订挑战："+FOCI[focus],
        prompt="这次只聚焦："+FOCI[focus]+"。以下是修订后的个人命题，仍可能有误。\n命题："+binding["edge"]["label"]+"\n条件："+binding["edge"]["note"]+"\n"+prompt+"\n最后核对：你的新命题在这里是否成立，还需要补什么？",
        options=options,correct=correct,rationale=rationale)
    requirements={"path":"写出这道新情境的具体推导，核对修订命题本身；若命题仍有误，即便选择正确也不能标满足。",
                  "conditions":"说明本情境依赖的映射、样本权重或度量条件，对照修订后的文字，标出仍遗漏或过度概括的地方。",
                  "boundary":"给出具体反例或不能推出的结论，解释新命题的适用边界，不把本题答案当普遍证明。"}
    for c in task["criteria"]:c["requirement"]=requirements[c["id"]]+(" 本轮重点检查此条。" if c["id"]==focus else "")
    if binding["template"] in CHALLENGE_REQUIREMENTS:
        for c,r in zip(task["criteria"],CHALLENGE_REQUIREMENTS[binding["template"]]):
            c["requirement"]=r+" 同时检查修订命题本身，原命题仍有误不能因选择正确标满足。"+(" 本轮重点检查此条。" if c["id"]==focus else "")
        task["support"]=deepcopy(SUPPORT[binding["template"]])
    return task


def feedback(start,answer):
    origin=start.get("revision_origin")
    if not origin:return {}
    matches=answer["choice_matches"]
    return {"revision_origin":origin,"target_feedback":{"focus":origin["focus"],"title":FOCI[origin["focus"]],
        "selection":"unknown" if matches is None else "matches" if matches else "mismatch",
        "message":"本题选择符合规则，接着检查你写出的推导与命题。" if matches else "尚未验证选择，请对照规则补出推导。" if matches is None else "本题选择与规则不符，先定位计算、条件或结论中的差异。",
        "explanation_status":"pending_review","gap_status":"not_established"}}
