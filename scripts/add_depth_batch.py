"""One-time additive migration: attach deep drafts without claiming review completion."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATE = "2026-11-07"


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def write(path, data):
    (ROOT / path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    index = read("data/content/zh-CN/index.json")
    if any("depth_path" in article for article in index["articles"]):
        raise SystemExit("Depth batch already applied; edit canonical data instead.")
    catalogs = {kind: read(f"data/catalog/{kind}.json")
                for kind in ["domains", "entities", "sources", "relations", "backlog"]}
    by_name = {e["name"]: e for e in catalogs["entities"]["items"]}
    sources = catalogs["sources"]["items"]
    rows = [
        ("source-021", "Deep Learning Chapter 8: Optimization", "author_textbook", "https://www.deeplearningbook.org/contents/optimization.html", "章节引言、病态条件与优化器目录；未完整审校全章", "online"),
        ("source-022", "Deep Learning Chapter 7: Regularization", "author_textbook", "https://www.deeplearningbook.org/contents/regularization.html", "引言及L2惩罚与曲率方向的部分分析；未完整审校全章", "online"),
        ("source-023", "Deep Learning Chapter 4: Numerical Computation", "author_textbook", "https://www.deeplearningbook.org/contents/numerical.html", "数值计算与梯度优化的部分章节；未逐式审校", "online"),
        ("source-024", "Deep Learning Chapter 6: Deep Feedforward Networks", "author_textbook", "https://www.deeplearningbook.org/contents/mlp.html", "章节引言及输出目标相关内容定位；未完整审校全章", "online"),
        ("source-025", "Hugging Face Tokenization algorithms", "official_documentation", "https://huggingface.co/docs/transformers/main/tokenizer_summary", "BPE、字节级与SentencePiece部分说明；未复现词表训练", "main（动态文档）"),
        ("source-026", "D2L中文10.5 多头注意力", "author_textbook", "https://zh.d2l.ai/chapter_attention-mechanisms/multihead-attention.html", "多头结构和投影说明；未运行教材实现", "2.0.0"),
        ("source-027", "D2L中文10.6 自注意力和位置编码", "author_textbook", "https://zh.d2l.ai/chapter_attention-mechanisms/self-attention-and-positional-encoding.html", "自注意力及位置机制的部分说明；未完整审校代码", "2.0.0"),
        ("source-028", "PyTorch scaled_dot_product_attention", "official_documentation", "https://docs.pytorch.org/docs/2.15/generated/torch.nn.functional.scaled_dot_product_attention.html", "函数参考、缩放/布尔掩码语义、dropout和实现选择；未运行PyTorch内核", "2.15"),
        ("source-029", "PyTorch AdamW", "official_documentation", "https://docs.pytorch.org/docs/2.15/generated/torch.optim.AdamW.html", "接口、更新伪代码、参数组及衰减说明；未运行框架实现", "2.15"),
    ]
    for sid, title, kind, url, scope, version in rows:
        if any(source["id"] == sid for source in sources):
            raise ValueError(f"Source ID already used: {sid}")
        creator = ("Ian Goodfellow; Yoshua Bengio; Aaron Courville" if "deeplearningbook" in url
                   else "D2L authors / 中文版维护者" if "d2l.ai" in url
                   else "PyTorch contributors" if "pytorch.org" in url else "Hugging Face contributors")
        sources.append({"id": sid, "title": title, "creator": creator, "source_type": kind,
                        "url": url, "checked_on": DATE, "checked_scope": scope, "access_status": "section_checked",
                        "observed_version": version, "reuse_status": "not_assessed",
                        "stored_material": "metadata_and_original_notes_only"})
    for source in sources:
        if source["id"] == "source-004":
            source["checked_scope"] = "摘要及HTML正文第1—2节关于L2、SGD与Adam更新区别：https://arxiv.org/html/1711.05101v3；未复现实验"

    added = [
        ("Jacobian", ["雅可比矩阵"], "concept", "domain-001"),
        ("Hessian", ["海森矩阵"], "concept", "domain-001"),
        ("自动微分", ["Automatic Differentiation"], "algorithm_family", "domain-006"),
        ("预归一化", ["Pre-Norm"], "mechanism", "domain-007"),
        ("后归一化", ["Post-Norm"], "mechanism", "domain-007"),
        ("GQA", ["Grouped-Query Attention", "分组查询注意力"], "mechanism", "domain-007"),
        ("MQA", ["Multi-Query Attention", "多查询注意力"], "mechanism", "domain-007"),
        ("SwiGLU", [], "mechanism", "domain-006"),
        ("SentencePiece", [], "system_mechanism", "domain-008"),
        ("填充掩码", ["Padding Mask"], "mechanism", "domain-007"),
        ("梯度消失", ["Vanishing Gradients"], "concept", "domain-006"),
        ("梯度爆炸", ["Exploding Gradients"], "concept", "domain-006"),
    ]
    next_id = max(int(e["id"].split("-")[1]) for e in by_name.values()) + 1
    for offset, (name, aliases, kind, domain) in enumerate(added):
        if name in by_name:
            raise ValueError(f"Existing entity: {name}")
        entity = {"id": f"entity-{next_id + offset:04}", "name": name, "aliases": aliases,
                  "entity_type": kind, "domain_ids": [domain], "content_status": "candidate",
                  "game_status": "not_designed", "source_links": [], "notes": "深入档案发现的覆盖缺口；待独立来源、定义与关系核查。"}
        catalogs["entities"]["items"].append(entity)
        by_name[name] = entity
    assignments = {
        "source-021": ["梯度下降", "Momentum", "Adam"],
        "source-022": ["L2 正则", "L1 正则"], "source-023": ["梯度", "Hessian"],
        "source-024": ["损失函数", "交叉熵", "前馈网络"],
        "source-025": ["token", "tokenizer", "BPE", "WordPiece", "Unigram 分词", "SentencePiece"],
        "source-026": ["多头注意力", "Transformer"], "source-027": ["位置编码", "自注意力"],
        "source-028": ["缩放点积注意力", "GQA", "填充掩码"], "source-029": ["AdamW", "权重衰减"],
    }
    for sid, names in assignments.items():
        locator = next(s["checked_scope"] for s in sources if s["id"] == sid)
        for name in names:
            by_name[name]["source_links"].append({"source_id": sid, "locator": locator,
                "purpose": "candidate_reference", "review_status": "pending"})
            by_name[name]["content_status"] = "source_registered"

    relation_rows = [
        ("损失函数", "梯度下降", "related_to", "目标给出优化标准，梯度下降是利用梯度的更新方法。", "区分单样本损失、总目标与更新方法。", ["source-021"]),
        ("梯度", "链式法则", "related_to", "复合目标可利用链式法则求参数梯度。", "区分可微性、求导计算与参数更新。", ["source-017"]),
        ("反向传播", "梯度下降", "related_to", "反向传播求导与梯度下降更新参数是不同职责。", "并非所有求导都用于梯度下降。", ["source-021", "source-024"]),
        ("L2 正则", "梯度下降", "related_to", "L2修改目标梯度，更新算法决定惩罚怎样作用于参数。", "明确优化器和系数约定。", ["source-004", "source-022"]),
        ("Transformer", "token", "related_to", "文本输入的处理单位通过表示进入架构。", "文本情境，不推广为所有模态必须经文本tokenizer。", ["source-003", "source-015"]),
        ("Transformer", "因果掩码", "uses", "因果解码器用掩码限制访问未来位置。", "不是所有Transformer都使用相同掩码。", ["source-003", "source-028"]),
        ("填充掩码", "因果掩码", "related_to", "填充与因果掩码限制不同的信息访问范围。", "接口真假语义必须核查，损失忽略项另行处理。", ["source-028"]),
        ("交叉熵", "KL 散度", "related_to", "固定有效目标分布时交叉熵与KL含有常数差项。", "概率有效且相应项有限；不能忽略目标分布是否变化。", ["source-024"]),
        ("SentencePiece", "BPE", "related_to", "SentencePiece可支持BPE等算法。", "工具体系不是单一切分算法，配置与版本需固定。", ["source-025"]),
        ("SentencePiece", "Unigram 分词", "related_to", "SentencePiece可支持Unigram方法。", "不能把WordPiece、BPE、Unigram视为同义词。", ["source-025"]),
    ]
    next_relation = max(int(r["id"].split("-")[1]) for r in catalogs["relations"]["items"]) + 1
    for offset, (a, b, kind, statement, conditions, refs) in enumerate(relation_rows):
        catalogs["relations"]["items"].append({"id": f"relation-{next_relation + offset:04}",
            "from_id": by_name[a]["id"], "to_id": by_name[b]["id"], "relation_type": kind,
            "statement": statement, "conditions": conditions, "source_ids": refs,
            "review_status": "proposed", "reviewed_by": None, "reviewed_on": None, "hard_prerequisite": False})

    article_sources = [
        ["source-016", "source-024"], ["source-017", "source-023"],
        ["source-012", "source-021"], ["source-013", "source-004", "source-022", "source-029"],
        ["source-003", "source-014", "source-015", "source-026", "source-027"],
        ["source-015", "source-025"], ["source-003", "source-018", "source-026", "source-028"],
        ["source-020", "source-019", "source-024"],
    ]
    gaps = [
        ["概率建模推导", "Huber/对比/排序损失独立档案"],
        ["自动微分与反向传播完整实现", "多变量形状规范"],
        ["强凸收敛率证明", "随机梯度方差分析", "完整优化器比较"],
        ["岭回归矩阵解", "高斯先验推导", "完整Adam/AdamW对照"],
        ["完整架构实现", "现代变体深入档案", "真实训练与推理实验"],
        ["完整词表训练", "真实tokenizer回归样本"],
        ["多头和反向参考实现", "融合内核与缓存实验"],
        ["多标签与二元损失独立档案", "语言模型完整目标错位实验"],
    ]
    for article, refs, open_gaps in zip(index["articles"], article_sources, gaps):
        path = Path(article["path"])
        article.update(depth_path=str(path.parent / "deep" / path.name).replace("\\", "/"),
                       depth_source_ids=refs, depth_status="layered_draft", open_gaps=open_gaps)
        if not (ROOT / article["depth_path"]).is_file():
            raise ValueError(f"Missing deep draft: {article['depth_path']}")
    index["content_version"] = "0.2.0"
    index["schema_version"] = "0.2.0"
    for catalog in catalogs.values():
        catalog.update(dataset_version="0.1.2", updated_on=DATE)
    from check_catalog import validate
    validate({kind: data["items"] for kind, data in catalogs.items()})
    for kind, data in catalogs.items():
        write(f"data/catalog/{kind}.json", data)
    write("data/content/zh-CN/index.json", index)
    print("Attached 8 deep drafts; added 12 candidate entities, 9 sources and 10 proposed relations.")


if __name__ == "__main__":
    main()
