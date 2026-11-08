"""Register only observed benchmark pages; product research is not technical review."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATE = "2026-11-07"


def main():
    path = ROOT / "data/catalog/sources.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))
    rows = [
        ("小林coding首页", "小林coding", "https://www.xiaolincoding.com/", "index_checked", "系列入口、导航与站点自述，未审阅全站"),
        ("小林coding图解系统介绍", "小林coding", "https://www.xiaolincoding.com/os/", "page_checked", "阅读方式、目录、反馈与更新说明"),
        ("小林coding虚拟内存样本", "小林coding", "https://www.xiaolincoding.com/os/3_memory/vmem.html", "section_checked", "问题推进与插图位置的结构抽样；未视觉审查所有图片，不作为AI技术依据"),
        ("卡码笔记首页", "程序员Carl / 卡码笔记维护者", "https://notes.kamacoder.com/", "index_checked", "专题入口、版本与反馈自述"),
        ("卡码笔记大模型学习路线", "程序员Carl / 卡码笔记维护者", "https://notes.kamacoder.com/llm/", "index_checked", "入门、应用、原理和手写实现的专题目录；未逐篇核查"),
        ("代码随想录算法路线", "程序员Carl", "https://programmercarl.com/algo/", "page_checked", "推荐顺序、专题导读与补充训练入口；非LLM技术证据"),
        ("LLMGuide首页", "Meko1 / LLMGuide维护者", "https://meko1.github.io/llm-interview-guide/", "page_checked", "路线、分层与主题入口；未实际操作知识地图筛选和推荐"),
        ("LLMGuide Transformer架构详解", "Meko1 / LLMGuide维护者", "https://meko1.github.io/llm-interview-guide/basics/transformer", "section_checked", "正文结构、前向走查、形状与子专题链接；未认证全部技术结论"),
        ("LLMGuide Attention与变体", "Meko1 / LLMGuide维护者", "https://meko1.github.io/llm-interview-guide/basics/attention", "page_checked", "专题组织与关联目录抽样；未逐式独立核查"),
        ("CodeFun2000题库入口", "CodeFun2000", "https://codefun2000.com/bank", "index_checked", "题库分组与搜索入口；未访问付费题或执行提交"),
        ("codefun.com访问待确认", "待确认", "https://codefun.com/", "unavailable", "本轮网页工具无法访问；不推断其身份，不视为CodeFun2000别名"),
    ]
    if any(s["url"] == rows[0][2] for s in catalog["items"]):
        raise SystemExit("Benchmark batch already registered")
    next_id = max(int(s["id"].split("-")[1]) for s in catalog["items"]) + 1
    for offset, (title, creator, url, status, scope) in enumerate(rows):
        catalog["items"].append({"id": f"source-{next_id + offset:03}", "title": title,
            "creator": creator, "source_type": "question_bank" if "codefun" in url else "author_course",
            "url": url, "checked_on": DATE, "checked_scope": "产品与教学组织对标：" + scope,
            "access_status": status, "observed_version": "live", "reuse_status": "not_assessed",
            "stored_material": "metadata_and_original_notes_only"})
    # Keep every catalog's dataset label consistent for this snapshot.
    for name in ["domains", "entities", "sources", "relations", "backlog"]:
        target = ROOT / f"data/catalog/{name}.json"
        data = catalog if name == "sources" else json.loads(target.read_text(encoding="utf-8"))
        data.update(dataset_version="0.1.3", updated_on=DATE)
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Registered {len(rows)} benchmark source records, including one inaccessible domain.")


if __name__ == "__main__":
    main()
