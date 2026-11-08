"""Check Chinese draft references and render the human-readable local index."""

import argparse
import json
import re
from pathlib import Path

from check_catalog import ROOT, load_catalog

DEPTH_HEADINGS = ["问题与直觉", "定义与符号", "推导与机制", "实现与实验",
                  "对比与变体", "边界与排错", "图谱与迁移", "任务与评价"]


def validate_content(index, catalog, root=ROOT):
    entities = {e["id"] for e in catalog["entities"]}
    sources = {s["id"] for s in catalog["sources"]}
    article_ids, paths, term_entities = set(), set(), set()
    for term in index["glossary"]:
        if term["entity_id"] in term_entities:
            raise ValueError("Duplicate glossary entity")
        term_entities.add(term["entity_id"])
        if term["entity_id"] not in entities or not set(term["source_ids"]) <= sources:
            raise ValueError("Unknown glossary reference")
        if not term["first_mention"].startswith(term["display_name"] + "（"):
            raise ValueError("Missing first-mention Chinese explanation")
    for article in index["articles"]:
        if article["id"] in article_ids or article["path"] in paths:
            raise ValueError("Duplicate article identity or path")
        article_ids.add(article["id"])
        paths.add(article["path"])
        if article["entity_id"] not in entities or not set(article["source_ids"]) <= sources:
            raise ValueError("Unknown article reference")
        path = (root / article["path"]).resolve()
        content_root = (root / "knowledge/zh-CN").resolve()
        if not path.is_relative_to(content_root):
            raise ValueError("Article path outside Chinese content directory")
        if not path.is_file():
            raise ValueError(f"Missing article: {article['path']}")
        text = path.read_text(encoding="utf-8")
        if not text.startswith("# " + article["title"] + "\n"):
            raise ValueError(f"Title differs from index: {article['id']}")
        if "草稿" not in text:
            raise ValueError(f"Missing draft label: {article['id']}")
        for target in re.findall(r"\]\((\./[^)]+)\)", text):
            if not (path.parent / target).resolve().is_file():
                raise ValueError(f"Broken relative content link: {target}")
        if "depth_path" not in article:
            raise ValueError("Missing layered depth draft")
        if not set(article["depth_source_ids"]) <= sources:
            raise ValueError("Unknown depth source reference")
        deep_path = (root / article["depth_path"]).resolve()
        if not deep_path.is_relative_to((content_root / "deep").resolve()):
            raise ValueError("Depth path outside deep content directory")
        if not deep_path.is_file():
            raise ValueError("Missing depth content file")
        deep_text = deep_path.read_text(encoding="utf-8")
        for position, heading in enumerate(DEPTH_HEADINGS, 1):
            if f"## {position}. {heading}" not in deep_text:
                raise ValueError(f"Missing depth section: {heading}")
        if article["depth_status"] != "layered_draft" or not article["open_gaps"]:
            raise ValueError("Depth draft must retain maturity status and explicit gaps")
        for target in re.findall(r"\]\((\.{1,2}/[^)]+)\)", deep_text):
            if not (deep_path.parent / target).resolve().is_file():
                raise ValueError(f"Broken deep content link: {target}")
    return len(article_ids), len(term_entities)


def render_index(index):
    lines = ["# 中文知识库入口", "", "当前包含8张摘要入口及其8份分层深入档案，均为教学草稿，尚无可玩的游戏。", "",
             "名称保留常用英文，首次出现给出简明中文解释；术语会随知识地图持续增补。", "",
             "## 选择一个目标开始", "", "不要求按编号通读；按个人目标选择，基础缺口按需补齐。", "",
             "| 摘要入口 | 深入档案 | 当前状态 |", "| --- | --- | --- |"]
    for article in index["articles"]:
        filename = Path(article["path"]).name
        deep_filename = Path(article["depth_path"]).name
        lines.append(f"| [{article['title']}](./{filename}) | [原理、推导、实现与边界](./deep/{deep_filename}) | 草稿，仍有缺口 |")
    lines += ["", "每份深入档案检查问题、定义、机制、实验、变体、排错、图谱联系与评价。深度保存在知识库中，学习时按能力分轮展开。", "",
              "[查看深度标准](../../docs/content-depth-standard.md)；[查看各档案未完成项](../../docs/depth-coverage.md)。", "",
              "运行数值实验：`python examples/learning_lab.py`（在项目根目录运行）。仅使用Python标准库，不含完整Transformer或真实tokenizer。"]
    lines += ["", "## 贯穿专题", "",
              "[Transformer训练与生成专题](./transformer/README.md)：自制全链路图、4个模块文档、8个练习与3个独立挑战草案，另有可运行的一层因果教学模型。", "",
              "运行教学模型：`python examples/tiny_transformer.py`，需要PyTorch；仅验证合成数据训练流程，不代表真实文本能力。"]
    lines += ["", "## 首次出现的术语说明", "", "以下是草稿词表，不是进入游戏前必须背完的清单。", ""]
    for term in index["glossary"]:
        lines.append(f"- {term['first_mention']}")
    lines += ["", "## 来源与维护", "",
              "知识卡末尾保留资料链接。细分核查范围见 ../../data/catalog/sources.json，当前内容清单见 ../../data/content/zh-CN/index.json。",
              "", "本入口由 scripts/check_chinese_content.py --write-index 生成；正文知识卡独立维护，不由目录脚本覆盖。", ""]
    return "\n".join(lines)


def render_depth_report(index):
    lines = ["# 中文档案深度与缺口报告", "", f"内容版本：{index['content_version']}。由当前内容索引生成。", "",
             "八项检查面已写入8份深入草稿，但章节存在不证明内容已充分、正确或教学有效。所有实体仍待独立审校，研究层不视为完成。", "",
             "| 目标 | 当前深入内容 | 明确未完成项 |", "| --- | --- | --- |"]
    for article in index["articles"]:
        path = "../" + article["depth_path"]
        gaps = "；".join(article["open_gaps"])
        lines.append(f"| {article['title']} | [分层草稿]({path}) | {gaps} |")
    lines += ["", "跨领域覆盖仍看 catalog-coverage.md。单个代表样本的深度不能替代其他算法、来源和关系建设。", "",
              "数值实验覆盖：二次目标学习率边界、有限差分检查、L2解析最优值、固定对角缩放反例、稳定分类损失、注意力与掩码、玩具合并规则。", "",
              "已有[一层因果教学模型与训练/生成流程](../knowledge/zh-CN/transformer/README.md)，不再仅限单头内核。其样本为合成编号；尚无真实词表、原始完整编码器—解码器复现、独立测试质量结论、GPU内核比较或学习者试学。", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-index", action="store_true")
    args = parser.parse_args()
    index = json.loads((ROOT / "data/content/zh-CN/index.json").read_text(encoding="utf-8"))
    cards, terms = validate_content(index, load_catalog(ROOT / "data/catalog"))
    if args.write_index:
        (ROOT / "knowledge/zh-CN/README.md").write_text(render_index(index), encoding="utf-8")
        (ROOT / "docs/depth-coverage.md").write_text(render_depth_report(index), encoding="utf-8")
    print(f"PASS: Chinese cards={cards}, glossary terms={terms}; references and local paths valid.")


if __name__ == "__main__":
    main()
