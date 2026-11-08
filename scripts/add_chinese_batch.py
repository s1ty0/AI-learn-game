"""One-time additive migration for Chinese draft cards; never reseed existing IDs."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATE = "2026-11-07"


def main():
    index_path = ROOT / "data/content/zh-CN/index.json"
    if index_path.exists():
        raise SystemExit("Chinese batch already exists; edit canonical records instead.")
    catalogs = {kind: json.loads((ROOT / f"data/catalog/{kind}.json").read_text(encoding="utf-8"))
                for kind in ["entities", "sources", "relations", "backlog"]}
    entities = catalogs["entities"]["items"]
    sources = catalogs["sources"]["items"]
    by_name = {e["name"]: e for e in entities}
    next_entity = max(int(e["id"].split("-")[1]) for e in entities) + 1
    new_entities = [
        ("token", ["词元", "文本处理单位"], "concept", "domain-008"),
        ("tokenizer", ["分词器", "标记器"], "system_mechanism", "domain-008"),
        ("logits", ["未归一化分数", "logit"], "concept", "domain-006"),
        ("注意力机制", ["Attention", "attention"], "mechanism", "domain-007"),
        ("前馈网络", ["Feed-Forward Network", "FFN"], "architecture", "domain-006"),
    ]
    for offset, (name, aliases, kind, domain) in enumerate(new_entities):
        if name in by_name:
            raise ValueError(f"Unexpected existing entity: {name}")
        record = {"id": f"entity-{next_entity + offset:04}", "name": name, "aliases": aliases,
                  "entity_type": kind, "domain_ids": [domain], "content_status": "candidate",
                  "game_status": "not_designed", "source_links": [],
                  "notes": "中文版增补实体；正式定义、全部变体和任务仍待审校。"}
        entities.append(record)
        by_name[name] = record

    rows = [
        ("source-012", "动手学深度学习 11.3 梯度下降", "author_textbook", "https://zh.d2l.ai/chapter_optimization/gd.html", "11.3.1、学习率及11.3.2的更新与边界；未运行教材代码", "2.0.0"),
        ("source-013", "动手学深度学习 4.5 权重衰减", "author_textbook", "https://zh.d2l.ai/chapter_multilayer-perceptrons/weight-decay.html", "公式4.5.1—4.5.3及L2惩罚说明；实现未复现", "2.0.0"),
        ("source-014", "动手学深度学习 10.7 Transformer", "author_textbook", "https://zh.d2l.ai/chapter_attention-mechanisms/transformer.html", "10.7.1模型及子模块目录；未核查全部代码", "2.0.0"),
        ("source-015", "Hugging Face 中文 Tokenizers", "author_course", "https://huggingface.co/learn/llm-course/zh-CN/chapter2/4", "文本到编号、词/字符/子词切分介绍；未运行真实tokenizer", "live"),
        ("source-016", "动手学深度学习 3.1 线性回归", "author_textbook", "https://zh.d2l.ai/chapter_linear-networks/linear-regression.html", "3.1.1.2损失函数及平方误差公式；不覆盖全章主张", "2.0.0"),
        ("source-017", "动手学深度学习 2.4 微积分", "author_textbook", "https://zh.d2l.ai/chapter_preliminaries/calculus.html", "2.4.2偏导与2.4.3梯度定义；未核查全章练习", "2.0.0"),
        ("source-018", "动手学深度学习 10.3 注意力评分函数", "author_textbook", "https://zh.d2l.ai/chapter_attention-mechanisms/attention-scoring-functions.html", "章节引言及公式10.3.1—10.3.2；未核查全部代码", "2.0.0"),
        ("source-019", "动手学深度学习 3.4 softmax回归", "author_textbook", "https://zh.d2l.ai/chapter_linear-networks/softmax-regression.html", "3.4.2未归一化分数与3.4.4概率约束；未核查全章", "2.0.0"),
        ("source-020", "PyTorch CrossEntropyLoss", "official_documentation", "https://docs.pytorch.org/docs/2.15/generated/torch.nn.CrossEntropyLoss.html", "接口说明中输入logits、类别目标与损失定义；未运行接口", "2.15"),
    ]
    for sid, title, kind, url, scope, version in rows:
        if any(s["id"] == sid for s in sources):
            raise ValueError(f"Unexpected source ID: {sid}")
        creator = "D2L authors / 中文版维护者" if kind == "author_textbook" else (
            "Hugging Face course contributors / 中文版维护者" if kind == "author_course" else "PyTorch contributors")
        sources.append({"id": sid, "title": title, "creator": creator, "source_type": kind,
                        "url": url, "checked_on": DATE, "checked_scope": scope,
                        "access_status": "section_checked", "observed_version": version,
                        "reuse_status": "not_assessed", "stored_material": "metadata_and_original_notes_only"})
    for source in sources:
        if source["id"] == "source-003":
            source.update(access_status="section_checked", checked_on=DATE,
                          checked_scope="摘要及HTML正文第3.1—3.2节、架构与位置编码章节定位：https://arxiv.org/html/1706.03762v7；未复现实验")
        if source["id"] == "source-004":
            source.update(access_status="section_checked", checked_on=DATE,
                          checked_scope="摘要及HTML正文第1节关于L2、SGD与Adam的比较：https://arxiv.org/html/1711.05101v3；未复现实验")

    links = {
        "source-012": ["梯度下降", "学习率"],
        "source-013": ["L2 正则", "权重衰减", "目标函数"],
        "source-014": ["Transformer", "多头注意力", "层归一化", "残差连接", "前馈网络", "位置编码", "编码器", "解码器"],
        "source-015": ["token", "tokenizer", "词嵌入"],
        "source-016": ["损失函数", "均方误差", "线性回归"],
        "source-017": ["梯度", "偏导", "导数"],
        "source-018": ["注意力机制", "Softmax"],
        "source-019": ["logits", "Softmax"],
        "source-020": ["交叉熵", "logits"],
    }
    for sid, names in links.items():
        scope = next(s["checked_scope"] for s in sources if s["id"] == sid)
        for name in names:
            by_name[name]["source_links"].append({"source_id": sid, "locator": scope,
                                                  "purpose": "candidate_reference", "review_status": "pending"})
            by_name[name]["content_status"] = "source_registered"

    relation_rows = [
        ("tokenizer", "token", "produces", "文本tokenizer依据规则将文本转换为token序列及相应编号。", "具体切分依赖词表、版本和设置。", ["source-015"]),
        ("token", "词嵌入", "related_to", "文本token通常经编号关联到嵌入表示。", "区分单位、编号和向量；不声称所有模型的输入均为文本。", ["source-015", "source-003"]),
        ("Transformer", "前馈网络", "has_component", "原始Transformer包含逐位置的前馈网络。", "需明确原始架构与其他变体，不能以注意力替代所有模块。", ["source-003", "source-014"]),
        ("缩放点积注意力", "Softmax", "uses", "缩放点积注意力通过Softmax得到每个查询对各键的权重。", "明确计算维度、掩码和额外训练处理。", ["source-003", "source-018"]),
        ("交叉熵", "logits", "related_to", "PyTorch CrossEntropyLoss使用logits作为模型输入。", "这是指定接口的输入约定，数学交叉熵可由概率定义。", ["source-020"]),
    ]
    next_relation = max(int(r["id"].split("-")[1]) for r in catalogs["relations"]["items"]) + 1
    for offset, (a, b, kind, statement, conditions, refs) in enumerate(relation_rows):
        catalogs["relations"]["items"].append({"id": f"relation-{next_relation + offset:04}",
            "from_id": by_name[a]["id"], "to_id": by_name[b]["id"], "relation_type": kind,
            "statement": statement, "conditions": conditions, "source_ids": refs,
            "review_status": "proposed", "reviewed_by": None, "reviewed_on": None, "hard_prerequisite": False})

    terms = [
        ("损失函数", "损失函数", "把任务中的预测或决策偏差转为可计算代价的函数。", ["source-016"]),
        ("梯度", "梯度", "由各参数偏导数组成、描述目标局部变化的向量。", ["source-017"]),
        ("梯度下降", "梯度下降", "利用目标对参数的梯度逐步更新参数的优化方法。", ["source-012"]),
        ("L2 正则", "L2 正则化", "向目标加入指定权重平方和惩罚的正则方法。", ["source-013", "source-004"]),
        ("Transformer", "Transformer", "一类以注意力机制为核心的神经网络架构。", ["source-003", "source-014"]),
        ("token", "token", "文本被切分后用于模型处理的基本单位，不固定等于一个字或一个词。", ["source-015"]),
        ("tokenizer", "tokenizer", "将文本切分成单位并转换为模型所需编号的组件。", ["source-015"]),
        ("logits", "logits", "尚未转换为类别概率的模型输出分数。", ["source-019", "source-020"]),
        ("Softmax", "Softmax", "把一组分数转换为非负、总和为1的权重的函数。", ["source-019"]),
        ("缩放点积注意力", "缩放点积注意力", "缩放查询与键的点积分数后生成权重、再汇聚值的计算。", ["source-003"]),
        ("多头注意力", "多头注意力", "组合多个注意力头的输出以形成表示的模块。", ["source-003"]),
        ("词嵌入", "嵌入表示", "把输入单位映射到模型使用的向量表示。", ["source-003", "source-015"]),
        ("残差连接", "残差连接", "把模块输入与适当维度的模块输出相加的连接。", ["source-003", "source-014"]),
        ("层归一化", "层归一化", "对指定特征维度进行归一化并使用可学习参数调整的操作。", ["source-014"]),
        ("交叉熵", "交叉熵损失", "用目标分布与预测概率计算分类代价的一类损失。", ["source-020"]),
        ("学习率", "学习率", "参与控制优化更新步幅的超参数，步幅还取决于梯度和更新规则。", ["source-012"]),
    ]
    glossary = [{"entity_id": by_name[name]["id"], "display_name": display,
                 "first_mention": f"{display}（{explanation}）", "explanation": explanation,
                 "source_ids": refs, "status": "draft"}
                for name, display, explanation, refs in terms]
    article_rows = [
        ("损失函数", "01-loss-function.md", "损失函数：让训练有明确的比较标准", ["source-016"]),
        ("梯度", "02-gradient.md", "梯度：描述目标怎样随参数变化", ["source-017"]),
        ("梯度下降", "03-gradient-descent.md", "梯度下降：用局部信息逐步更新参数", ["source-012"]),
        ("L2 正则", "04-l2-regularization.md", "L2 正则化：把参数惩罚加入目标", ["source-013", "source-004"]),
        ("Transformer", "05-transformer.md", "Transformer：让不同位置的信息相互联系", ["source-003", "source-014", "source-015"]),
        ("token", "06-token.md", "token：文本怎样变成模型的输入单位", ["source-015"]),
        ("缩放点积注意力", "07-scaled-dot-product-attention.md", "缩放点积注意力：算权重，再汇聚信息", ["source-003", "source-018"]),
        ("交叉熵", "08-cross-entropy.md", "交叉熵损失：检查给目标类别分配了多少概率", ["source-020", "source-019"]),
    ]
    articles = [{"id": f"article-zh-{i:03}", "entity_id": by_name[name]["id"], "title": title,
                 "path": f"knowledge/zh-CN/{filename}", "source_ids": refs, "locale": "zh-CN",
                 "status": "draft", "reviewed_by": None, "reviewed_on": None}
                for i, (name, filename, title, refs) in enumerate(article_rows, 1)]
    index = {"schema_version": "0.1.0", "content_version": "0.1.0", "locale": "zh-CN",
             "updated_on": DATE, "language_policy": "docs/language-policy.md",
             "glossary": glossary, "articles": articles}
    # Validate all in-memory cross references before writing any canonical JSON.
    from check_catalog import load_catalog, validate
    combined = load_catalog(ROOT / "data/catalog")
    for kind, catalog in catalogs.items():
        combined[kind] = catalog["items"]
    validate(combined)
    for article in articles:
        if not (ROOT / article["path"]).is_file():
            raise ValueError(f"Missing article: {article['path']}")
    for kind, catalog in catalogs.items():
        catalog["updated_on"] = DATE
        catalog["dataset_version"] = "0.1.1"
        (ROOT / f"data/catalog/{kind}.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    domain_path = ROOT / "data/catalog/domains.json"
    domain_catalog = json.loads(domain_path.read_text(encoding="utf-8"))
    domain_catalog.update(dataset_version="0.1.1", updated_on=DATE)
    domain_path.write_text(json.dumps(domain_catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Added {len(new_entities)} entities, {len(rows)} sources, {len(relation_rows)} relations; {len(articles)} Chinese cards and {len(glossary)} terms.")


if __name__ == "__main__":
    main()
