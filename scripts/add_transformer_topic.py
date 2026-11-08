"""One-time topic registration. Keeps drafts separate from assessed learner states."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATE = "2026-11-07"


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def write(path, data):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    if (ROOT / "data/topics/transformer.json").exists():
        raise SystemExit("Topic already registered; maintain existing records.")
    catalogs = {kind: read(f"data/catalog/{kind}.json") for kind in ["domains", "entities", "sources", "relations", "backlog"]}
    by_name = {e["name"]: e for e in catalogs["entities"]["items"]}
    sources = catalogs["sources"]["items"]
    next_id = max(int(s["id"].split("-")[1]) for s in sources) + 1
    registered = {}
    for offset, (name, file, scope, names) in enumerate([
        ("Embedding", "Embedding", "查表、输入编号与输出形状；未逐项核查稀疏梯度等选项", ["词嵌入"]),
        ("LayerNorm", "LayerNorm", "归一化轴、方差约定、仿射参数及训练/评估行为", ["层归一化"]),
    ]):
        sid = f"source-{next_id + offset:03}"
        sources.append({"id": sid, "title": "PyTorch " + name, "creator": "PyTorch contributors",
            "source_type": "official_documentation", "url": f"https://docs.pytorch.org/docs/2.15/generated/torch.nn.{file}.html",
            "checked_on": DATE, "checked_scope": scope, "access_status": "section_checked", "observed_version": "2.15",
            "reuse_status": "not_assessed", "stored_material": "metadata_and_original_notes_only"})
        registered[name] = sid
        for entity_name in names:
            entity = by_name[entity_name]
            entity["source_links"].append({"source_id": sid, "locator": scope, "purpose": "implementation", "review_status": "pending"})
            entity["content_status"] = "source_registered"

    module_rows = [
        ("TF-M01", "输入与位置", "input-and-position.md", ["token", "词嵌入", "位置编码"], ["source-003", "source-015", registered["Embedding"]]),
        ("TF-M02", "多头与掩码", "multihead-and-mask.md", ["多头注意力", "缩放点积注意力", "因果掩码", "填充掩码"], ["source-003", "source-026", "source-028"]),
        ("TF-M03", "残差归一化与FFN", "block-components.md", ["残差连接", "层归一化", "前馈网络", "预归一化"], ["source-003", registered["LayerNorm"]]),
        ("TF-M04", "训练与生成", "training-and-generation.md", ["交叉熵", "梯度下降", "自回归语言建模"], ["source-020", "source-003"]),
    ]
    modules = [{"id": mid, "title": title, "path": f"knowledge/zh-CN/transformer/{file}",
                "entity_ids": [by_name[name]["id"] for name in names], "source_ids": refs, "status": "draft"}
               for mid, title, file, names, refs in module_rows]
    topic = {"schema_version": "0.1.0", "kind": "topic", "id": "topic-transformer", "locale": "zh-CN",
             "status": "draft", "updated_on": DATE, "title": "Transformer训练与生成贯穿专题",
             "entity_id": by_name["Transformer"]["id"], "entry_path": "knowledge/zh-CN/transformer/README.md",
             "assets": ["knowledge/zh-CN/transformer/assets/flow.svg", "knowledge/zh-CN/transformer/assets/flow.png"],
             "example_path": "examples/tiny_transformer.py", "modules": modules,
             "practice_path": "data/quests/transformer.json", "assessment_path": "data/assessments/transformer-challenges.json",
             "limitations": ["合成编号，不是真实文本", "没有独立测试质量结论", "没有游戏界面或个人进度存储", "未完成独立教学审校和试学"]}
    practice_rows = [
        ("TF-Q01", "TF-M01", "编号与向量的区别", "查出[1,2,1]对应的玩具嵌入行，说明重复编号会怎样。", "token", "先找编号对应的表行，不比较编号大小。"),
        ("TF-Q02", "TF-M01", "单位与位置信息的区别", "比较同一编号在位置0与1处查表后、加位置后的表示。", "位置编码", "先分开看嵌入项与位置项。"),
        ("TF-Q03", "TF-M02", "分头与拼接的维度", "输入B×T×8、头数2，逐步填写Q/K/V及汇聚输出形状。", "多头注意力", "分头只拆特征宽度，不拆序列位置。"),
        ("TF-Q04", "TF-M02", "未来不可见的实验证据", "只改变后两个输入编号，预测前两个位置输出是否变化，再运行核查。", "因果掩码", "先列出每个查询允许访问的键。"),
        ("TF-Q05", "TF-M03", "位置汇聚与逐位置变换", "固定模块输入，只改变一个位置送入FFN的向量，预测直接影响范围。", "前馈网络", "区分直接读取与此前已经汇聚的信息。"),
        ("TF-Q06", "TF-M04", "下一位目标对齐", "对[1,2,3,4,5,6]写出输入与监督标签，解释因果可见性。", "自回归语言建模", "为输入的每个位置单独写下一编号。"),
        ("TF-Q07", "TF-M04", "损失忽略与掩码的职责", "将目标设置为-100后，判断它会不会自动屏蔽注意力读取。", "交叉熵", "分别画出注意力计算和损失计算的作用位置。"),
        ("TF-Q08", "TF-M04", "生成取值与追加", "从前缀[1,2]开始，说明取哪个位置的分数、怎样追加和继续。", "自回归语言建模", "区分已有前缀位置与待生成位置。"),
    ]
    practices = [{"id": qid, "module_id": mid, "goal": goal, "prompt": prompt,
                  "entity_ids": [by_name[name]["id"]], "status": "draft", "hint": hint,
                  "phases": ["predict", "operate", "explain", "revise_graph"],
                  "completion_evidence": ["独立预测与操作记录", "解释关键关系", "个人图谱修订提案"],
                  "routing_note": "练习提示不作为独立掌握证据，尚未接入自适应引擎。"}
                 for qid, mid, goal, prompt, name, hint in practice_rows]
    assessments = [
        {"id": "TF-A01", "family_id": "tf-head-shapes", "module_ids": ["TF-M02", "TF-M03"], "status": "draft",
         "entity_ids": [by_name[n]["id"] for n in ["多头注意力", "残差连接"]],
         "prompt": "独立变式：B=2、T=3、d=12、h=3；无偏置标准多头。写Q/K/V分头、权重、拼接输出形状与注意力投影参数量。若输出变成d=10，能否直接加到原输入？",
         "required_points": ["每个Q/K/V分头为2×3×3×4，轴依次批次/头/序列/头宽", "权重为2×3×3×3，拼接后2×3×12", "QKV与输出投影参数共4×12²=576", "输出宽度10不能直接残差加到宽度12，需显式投影或重设结构"],
         "critical_errors": ["拆错序列与头轴", "仅凭能广播就认定残差正确"],
         "remediation_module_ids": ["TF-M02", "TF-M03"]},
        {"id": "TF-A02", "family_id": "tf-leakage", "module_ids": ["TF-M02", "TF-M04"], "status": "draft",
         "entity_ids": [by_name[n]["id"] for n in ["因果掩码", "自回归语言建模"]],
         "prompt": "某模型训练损失很好，但固定前两项、改变后续输入时前两位置分数也变化。请提出可验证的解释和下一次最小实验。",
         "required_points": ["将未来访问或其他跨位置泄漏作为待验证原因，不仅凭现象唯一归因", "固定参数和前缀，检查因果权重及掩码开关的对照", "修复后复验前缀输出不依赖未来，但不把此项通过当作泛化证明"],
         "critical_errors": ["仅用损失低证明实现正确", "把屏蔽损失当作屏蔽注意力"],
         "remediation_module_ids": ["TF-M02", "TF-M04"]},
        {"id": "TF-A03", "family_id": "tf-alignment", "module_ids": ["TF-M01", "TF-M04"], "status": "draft",
         "entity_ids": [by_name[n]["id"] for n in ["token", "交叉熵", "自回归语言建模"]],
         "prompt": "完整序列[2,5,1,4]。写训练输入与目标。若最后一个目标被标为-100，哪几项贡献损失？从前缀[2,5]生成时取哪个位置的分数？",
         "required_points": ["输入[2,5,1]，目标[5,1,4]，忽略后目标[5,1,-100]", "仅前两个监督位置贡献损失；忽略标记不自动改变注意力可见性", "取当前前缀最后位置分数，选择新编号并追加；不用真实未来目标作为生成输入"],
         "critical_errors": ["输入与目标完全相同", "把编号距离解释为语义距离"],
         "remediation_module_ids": ["TF-M01", "TF-M04"]},
    ]
    for data in catalogs.values():
        data.update(dataset_version="0.1.4", updated_on=DATE)
    for kind, data in catalogs.items():
        write(f"data/catalog/{kind}.json", data)
    write("data/topics/transformer.json", topic)
    write("data/quests/transformer.json", {"schema_version": "0.1.0", "kind": "practice", "topic_id": topic["id"], "items": practices})
    write("data/assessments/transformer-challenges.json", {"schema_version": "0.1.0", "kind": "assessment", "topic_id": topic["id"], "items": assessments})
    print("Registered topic, 4 modules, 8 practice drafts, 3 challenge rubrics, 2 source records.")


if __name__ == "__main__":
    main()
