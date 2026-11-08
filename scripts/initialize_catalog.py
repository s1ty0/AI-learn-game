"""Initialize a candidate atlas from the authored scope; never overwrite a catalog."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATE = "2026-11-07"
VERSION = "0.1.0"


def envelope(kind, items):
    return {"schema_version": VERSION, "dataset_version": VERSION,
            "kind": kind, "updated_on": DATE, "items": items}


def build():
    domains, entities = [], []
    default_types = {
        "目标与损失": "objective", "优化": "algorithm",
        "正则与泛化": "training_method", "经典机器学习": "algorithm",
        "神经网络基础": "mechanism", "序列与注意力架构": "architecture",
        "表示与分词": "representation", "预训练与适配": "training_method",
        "偏好学习与强化学习": "training_method", "生成模型与多模态": "model_family",
        "推理与效率": "inference_method", "数据与评估": "evaluation_method",
        "检索与应用机制": "system_mechanism", "持续扩展分支": "domain",
    }
    overrides = {
        "KL 散度": "concept", "学习率调度": "training_method",
        "预热": "training_method", "梯度裁剪": "training_method",
        "主成分分析": "algorithm", "反向传播": "algorithm",
        "初始化": "training_method", "激活函数": "function_family",
        "因果掩码": "mechanism", "位置编码": "representation",
        "RoPE": "representation", "自注意力": "mechanism", "交叉注意力": "mechanism",
        "多头注意力": "mechanism", "马尔可夫决策过程": "concept",
        "价值函数": "concept", "奖励模型": "model_family",
        "Q-learning": "algorithm", "策略梯度": "algorithm", "PPO": "algorithm",
        "DPO": "algorithm", "Actor-Critic": "algorithm_family",
        "KV 缓存": "mechanism", "FlashAttention": "algorithm",
        "量化": "compression_method", "剪枝": "compression_method",
        "数据泄漏": "concept", "去重": "data_method",
        "准确率": "metric", "精确率": "metric", "召回率": "metric",
        "F1": "metric", "困惑度": "metric", "校准": "concept",
        "对照实验": "evaluation_method", "消融": "evaluation_method",
    }
    aliases = {
        "L2 正则": ["L2 正则化", "L2 regularization"],
        "L1 正则": ["L1 正则化", "L1 regularization"],
        "梯度下降": ["Gradient Descent", "GD"],
        "均方误差": ["Mean Squared Error", "MSE"],
        "交叉熵": ["Cross Entropy"], "负对数似然": ["Negative Log-Likelihood", "NLL"],
        "Transformer": ["Transformer architecture"],
        "反向传播": ["Backpropagation"], "权重衰减": ["Weight Decay"],
        "检索增强生成": ["Retrieval-Augmented Generation", "RAG"],
        "LoRA": ["Low-Rank Adaptation"], "DPO": ["Direct Preference Optimization"],
    }
    atlas = (ROOT / "docs/algorithm-atlas.md").read_text(encoding="utf-8")
    seed_section = atlas.split("## 2. 首批目录种子", 1)[1].split("## 3.", 1)[0]
    for line in seed_section.splitlines():
        if not line.startswith("| "):
            continue
        columns = [c.strip() for c in line.split("|")[1:-1]]
        if len(columns) != 3 or "、" not in columns[1]:
            continue
        label = columns[0]
        domain_id = f"domain-{len(domains) + 1:03}"
        domains.append({"id": domain_id, "name": label, "status": "candidate"})
        for name in columns[1].split("、"):
            entities.append({"id": f"entity-{len(entities) + 1:04}", "name": name,
                             "aliases": aliases.get(name, []),
                             "entity_type": overrides.get(name, default_types.get(label, "concept")),
                             "domain_ids": [domain_id], "content_status": "candidate",
                             "game_status": "not_designed", "source_links": [],
                             "notes": "目录种子；分类、定义、关系和教学内容均待逐项核查。"})
    if len(domains) != 15:
        raise ValueError("Expected the authored 15-domain seed table")
    by_name = {e["name"]: e for e in entities}
    extra = [
        ("损失函数", "function_family", "目标与损失"),
        ("目标函数", "function_family", "目标与损失"),
        ("模型参数", "concept", "神经网络基础"),
        ("学习率", "hyperparameter", "优化"),
        ("Softmax", "function", "神经网络基础"),
        ("缩放点积注意力", "mechanism", "序列与注意力架构"),
    ]
    for name, entity_type, domain in extra:
        domain_id = next(d["id"] for d in domains if d["name"] == domain)
        record = {"id": f"entity-{len(entities) + 1:04}", "name": name,
                  "aliases": [], "entity_type": entity_type, "domain_ids": [domain_id],
                  "content_status": "candidate", "game_status": "not_designed",
                  "source_links": [], "notes": "用于建立核心关系的候选实体，待核查。"}
        entities.append(record)
        by_name[name] = record

    # Scope describes what was actually read, not an endorsement of all linked content.
    source_rows = [
        ("source-001", "torch.nn", "PyTorch contributors", "official_documentation",
         "https://docs.pytorch.org/docs/2.15/nn.html", "Loss Functions 与模块索引", "section_checked", "2.15"),
        ("source-002", "torch.optim", "PyTorch contributors", "official_documentation",
         "https://docs.pytorch.org/docs/2.15/optim.html", "优化器索引与 SGD 条目", "section_checked", "2.15"),
        ("source-003", "Attention Is All You Need", "Ashish Vaswani et al.", "original_paper",
         "https://arxiv.org/abs/1706.03762v7", "标题、作者、摘要和版本记录；未核查正文", "abstract_checked", "v7"),
        ("source-004", "Decoupled Weight Decay Regularization", "Ilya Loshchilov; Frank Hutter", "original_paper",
         "https://arxiv.org/abs/1711.05101v3", "摘要中 L2 与权重衰减的条件性区别；未核查正文", "abstract_checked", "v3"),
        ("source-005", "LLM Course: Introduction", "Hugging Face course contributors", "author_course",
         "https://huggingface.co/learn/llm-course/chapter1/1", "课程介绍与目录；未审阅整套课程", "page_checked", "live"),
        ("source-006", "Dive into Deep Learning", "Aston Zhang; Zachary C. Lipton; Mu Li; Alexander J. Smola", "author_textbook",
         "https://d2l.ai/", "首页目录与版本标题；未逐章审校", "index_checked", "1.0.3"),
        ("source-007", "CodeFun2000", "CodeFun2000", "question_bank",
         "https://codefun2000.com/", "公开首页 AI/算法/大模型分类；未访问题目正文", "index_checked", "live"),
        ("source-008", "D2L 3.7 Weight Decay", "D2L authors", "author_textbook",
         "https://d2l.ai/chapter_linear-regression/weight-decay.html", "3.7.1 与 3.7.5 的正则化和更新条件；未核查全部代码", "section_checked", "1.0.3"),
        ("source-009", "D2L 3.1 Linear Regression", "D2L authors", "author_textbook",
         "https://d2l.ai/chapter_linear-regression/linear-regression.html", "小批量 SGD 更新描述与公式 3.1.10；未核查全部章节", "section_checked", "1.0.3"),
        ("source-010", "LoRA: Low-Rank Adaptation of Large Language Models", "Edward J. Hu et al.", "original_paper",
         "https://arxiv.org/abs/2106.09685v2", "标题、作者、摘要和版本记录；未核查正文", "abstract_checked", "v2"),
        ("source-011", "Direct Preference Optimization: Your Language Model is Secretly a Reward Model", "Rafael Rafailov et al.", "original_paper",
         "https://arxiv.org/abs/2305.18290v3", "标题、作者、摘要和版本记录；未核查正文", "abstract_checked", "v3"),
    ]
    sources = [{"id": sid, "title": title, "creator": creator, "source_type": stype,
                "url": url, "checked_on": DATE, "checked_scope": scope,
                "access_status": status, "observed_version": version,
                "reuse_status": "not_assessed", "stored_material": "metadata_and_original_notes_only"}
               for sid, title, creator, stype, url, scope, status, version in source_rows]

    def link(name, source_id, locator):
        by_name[name]["source_links"].append({"source_id": source_id, "locator": locator,
                                              "purpose": "candidate_reference", "review_status": "pending"})

    for name, locator in [("均方误差", "Loss Functions / nn.MSELoss"),
                          ("平均绝对误差", "Loss Functions / nn.L1Loss"),
                          ("交叉熵", "Loss Functions / nn.CrossEntropyLoss")]:
        link(name, "source-001", locator)
    for name in ["随机梯度下降", "Adam", "AdamW", "AdaGrad", "RMSProp"]:
        link(name, "source-002", "Algorithms / " + name + "（名称映射待复核）")
    for name in ["Transformer", "自注意力", "多头注意力"]:
        link(name, "source-003", "摘要与待核查的架构正文；摘要不足以验证模块细节")
    for name in ["L2 正则", "权重衰减", "AdamW"]:
        link(name, "source-004", "Abstract: optimizer-dependent equivalence distinction")
    link("L2 正则", "source-008", "3.7.1 Norms and Weight Decay; 3.7.5 Summary")
    for name in ["梯度下降", "小批量梯度下降", "梯度", "学习率", "线性回归"]:
        link(name, "source-009", "Minibatch SGD; equation 3.1.10（具体概念覆盖待复核）")
    link("LoRA", "source-010", "Abstract")
    link("DPO", "source-011", "Abstract")
    for entity in entities:
        if entity["source_links"]:
            entity["content_status"] = "source_registered"

    relation_rows = [
        ("损失函数", "均方误差", "has_example", "损失函数的一个具体选择是均方误差。", "需结合任务和定义核查。", ["source-001"]),
        ("损失函数", "交叉熵", "has_example", "损失函数的一个具体选择是交叉熵损失。", "区分数学交叉熵与具体 API 输入约定。", ["source-001"]),
        ("梯度下降", "梯度", "uses", "梯度下降使用目标对参数的梯度构造更新。", "针对适用的可微目标；不承诺全局最优。", ["source-009"]),
        ("梯度下降", "学习率", "uses", "学习率参与确定梯度下降的更新步幅。", "效果依赖目标、尺度和具体更新规则。", ["source-009"]),
        ("梯度下降", "模型参数", "updates", "梯度下降更新模型参数。", "需明确可优化参数与目标。", ["source-009"]),
        ("小批量梯度下降", "梯度下降", "variant_of", "小批量方法用批次构造梯度估计。", "术语层级和全批次定义需统一。", ["source-009"]),
        ("L2 正则", "目标函数", "modifies", "L2 惩罚可作为目标函数的一部分。", "明确惩罚系数、参数范围与归一化约定。", ["source-008"]),
        ("L2 正则", "权重衰减", "conditional_equivalence", "L2 正则与权重衰减的等价性取决于更新规则和系数约定。", "不能将普通 SGD 下的关系直接推广到 Adam 等自适应方法。", ["source-004", "source-008"]),
        ("AdamW", "Adam", "variant_of", "AdamW 对权重衰减进行解耦。", "需核查更新公式和实现参数。", ["source-004", "source-002"]),
        ("Transformer", "多头注意力", "has_component", "Transformer 架构包含多头注意力模块。", "原始架构与后续变体分别记录；正文待核查。", ["source-003"]),
        ("Transformer", "残差连接", "has_component", "原始 Transformer 使用残差连接。", "正文待核查，不将所有后续变体视为相同。", ["source-003"]),
        ("Transformer", "层归一化", "has_component", "原始 Transformer 使用层归一化。", "具体位置与现代变体需分开核查。", ["source-003"]),
        ("Transformer", "位置编码", "uses", "原始 Transformer 引入位置信息。", "区分原始方法与 RoPE 等后续方法。", ["source-003"]),
        ("多头注意力", "缩放点积注意力", "has_component", "原始多头注意力可结合多个缩放点积注意力头。", "需核查投影、拼接和维度；不定义为所有注意力变体的必需结构。", ["source-003"]),
        ("LoRA", "矩阵", "uses", "LoRA 使用低秩分解形式参数化适配更新。", "具体注入模块与秩的作用需核查正文。", ["source-010"]),
        ("DPO", "RLHF", "related_to", "DPO 与基于人类偏好的语言模型适配相关。", "比较目标、假设及训练流程，不能当作同义词。", ["source-011"]),
    ]
    relations = [{"id": f"relation-{i:04}", "from_id": by_name[a]["id"],
                  "to_id": by_name[b]["id"], "relation_type": kind, "statement": statement,
                  "conditions": conditions, "source_ids": source_ids,
                  "review_status": "proposed", "reviewed_by": None, "reviewed_on": None,
                  "hard_prerequisite": False}
                 for i, (a, b, kind, statement, conditions, source_ids) in enumerate(relation_rows, 1)]
    queue = [
        ("核查损失、梯度、更新与 L2 的定义、公式和符号", ["损失函数", "梯度下降", "L2 正则"], "content_review"),
        ("核查 Transformer 原始论文正文并拆分模块关系", ["Transformer"], "content_review"),
        ("为已登记但缺少来源的实体寻找一手依据", [], "source_gap"),
        ("寻找并审核通俗中文讲解与可复用范围", [], "teaching_source_gap"),
        ("逐项核查来源授权，当前不导入全文", [], "reuse_review"),
        ("定义首批算法目标的硬性先修与替代路线", ["梯度下降", "L2 正则", "Transformer"], "prerequisite_design"),
        ("补数学基础、视觉、语音等分支的细粒度条目", [], "coverage_gap"),
        ("建立算法交互实验与独立评价样本", ["损失函数", "梯度下降", "L2 正则"], "game_design"),
    ]
    backlog = [{"id": f"issue-{i:03}", "title": title, "entity_ids": [by_name[n]["id"] for n in names],
                "issue_type": kind, "status": "open", "created_on": DATE}
               for i, (title, names, kind) in enumerate(queue, 1)]
    return {"domains": domains, "entities": entities, "sources": sources,
            "relations": relations, "backlog": backlog}


def main():
    records = build()
    targets = {kind: ROOT / "data/catalog" / f"{kind}.json" for kind in records}
    if any(path.exists() for path in targets.values()):
        raise SystemExit("Catalog already exists; edit canonical JSON instead of reseeding.")
    for kind, items in records.items():
        targets[kind].parent.mkdir(parents=True, exist_ok=True)
        targets[kind].write_text(json.dumps(envelope(kind, items), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({kind: len(items) for kind, items in records.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
