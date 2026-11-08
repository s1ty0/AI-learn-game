"""Check cross-file integrity. Use Test-Json separately for JSON Schema validation."""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KINDS = ("domains", "entities", "sources", "relations", "backlog")


def load_catalog(directory):
    result = {}
    for kind in KINDS:
        document = json.loads((directory / f"{kind}.json").read_text(encoding="utf-8"))
        if document["kind"] != kind:
            raise ValueError(f"Wrong kind in {kind}.json")
        result[kind] = document["items"]
    return result


def validate(catalog):
    ids = {}
    for kind in KINDS:
        values = [item["id"] for item in catalog[kind]]
        if len(values) != len(set(values)):
            raise ValueError(f"Duplicate IDs in {kind}")
        ids[kind] = set(values)
    names = [item["name"].casefold() for item in catalog["entities"]]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate canonical entity names")

    for entity in catalog["entities"]:
        if not set(entity["domain_ids"]) <= ids["domains"]:
            raise ValueError(f"Unknown domain: {entity['id']}")
        for link in entity["source_links"]:
            if link["source_id"] not in ids["sources"] or not link["locator"].strip():
                raise ValueError(f"Invalid source link: {entity['id']}")
        if entity["content_status"] == "source_registered" and not entity["source_links"]:
            raise ValueError(f"Source-registered entity without source: {entity['id']}")
        if entity["content_status"] == "reviewed":
            if not entity.get("reviewed_by") or not entity.get("reviewed_on"):
                raise ValueError(f"Missing entity review evidence: {entity['id']}")
            if not any(link["review_status"] == "reviewed" for link in entity["source_links"]):
                raise ValueError(f"No reviewed source link: {entity['id']}")

    graph = defaultdict(list)
    seen = set()
    for relation in catalog["relations"]:
        start, end = relation["from_id"], relation["to_id"]
        if start not in ids["entities"] or end not in ids["entities"]:
            raise ValueError(f"Unknown relation endpoint: {relation['id']}")
        if not set(relation["source_ids"]) <= ids["sources"]:
            raise ValueError(f"Unknown relation source: {relation['id']}")
        key = (start, end, relation["relation_type"], relation["conditions"])
        if key in seen:
            raise ValueError(f"Duplicate relation: {relation['id']}")
        seen.add(key)
        if relation["review_status"] == "reviewed":
            if not relation["source_ids"] or not relation["reviewed_by"] or not relation["reviewed_on"]:
                raise ValueError(f"Missing relation review evidence: {relation['id']}")
        if relation["hard_prerequisite"]:
            if relation["relation_type"] != "prerequisite" or relation["review_status"] != "reviewed":
                raise ValueError(f"Unreviewed hard prerequisite: {relation['id']}")
            graph[start].append(end)

    active, visited = set(), set()

    def visit(node):
        if node in active:
            raise ValueError(f"Hard prerequisite cycle: {node}")
        if node in visited:
            return
        active.add(node)
        for target in graph.get(node, []):
            visit(target)
        active.remove(node)
        visited.add(node)

    for node in ids["entities"]:
        visit(node)
    for issue in catalog["backlog"]:
        if not set(issue["entity_ids"]) <= ids["entities"]:
            raise ValueError(f"Unknown backlog entity: {issue['id']}")


def report(catalog, dataset_version):
    lines = ["# 算法目录覆盖报告", "", f"数据版本：{dataset_version}。生成依据：当前本地目录，不代表整个领域的覆盖率。", "",
             "本报告只检查登记与结构；未完成的内容审校、公式、代码、关卡和评价不能据此视为完成。", "",
             "| 领域 | 已登记实体 | 已关联候选来源 | 已核查实体 | 可玩实体 |", "| --- | ---: | ---: | ---: | ---: |"]
    for domain in catalog["domains"]:
        entities = [e for e in catalog["entities"] if domain["id"] in e["domain_ids"]]
        linked = sum(bool(e["source_links"]) for e in entities)
        reviewed = sum(e["content_status"] == "reviewed" for e in entities)
        playable = sum(e["game_status"] in {"playable", "validated"} for e in entities)
        lines.append(f"| {domain['name']} | {len(entities)} | {linked} | {reviewed} | {playable} |")
    counts = {kind: len(catalog[kind]) for kind in KINDS}
    linked = sum(bool(e["source_links"]) for e in catalog["entities"])
    relation_states = dict(Counter(r["review_status"] for r in catalog["relations"]))
    inaccessible = sum(s["access_status"] == "unavailable" for s in catalog["sources"])
    benchmark = sum(s["checked_scope"].startswith("产品与教学组织对标：") for s in catalog["sources"])
    lines += ["", f"总计：{counts['domains']} 个领域、{counts['entities']} 个候选实体、{counts['sources']} 条来源记录、{counts['relations']} 条关系提案、{counts['backlog']} 项维护任务。",
              "", f"其中 {linked} 个实体已关联候选来源，{counts['entities'] - linked} 个尚未关联。",
              "", f"来源记录中 {benchmark} 条用于教学/产品组织对标，{inaccessible} 条当前无法访问；来源总数不能直接当作已核查的技术依据数量。",
              "", f"关系审核状态：`{json.dumps(relation_states, ensure_ascii=False)}`。",
              "", "当前没有通过内容审校的实体、已审核的硬性先修或可玩关卡。节点度数和孤立状态不代表玩家能力。",
              "", "接下来优先补未关联来源的条目、通俗中文讲解、算法正文核查、关键关系和硬性先修；详见 data/catalog/backlog.json。", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-report", action="store_true", help="Write docs/catalog-coverage.md after checks pass")
    args = parser.parse_args()
    catalog = load_catalog(ROOT / "data/catalog")
    validate(catalog)
    if args.write_report:
        version = json.loads((ROOT / "data/catalog/entities.json").read_text(encoding="utf-8"))["dataset_version"]
        (ROOT / "docs/catalog-coverage.md").write_text(report(catalog, version), encoding="utf-8")
    print("PASS: " + ", ".join(f"{kind}={len(catalog[kind])}" for kind in KINDS))


if __name__ == "__main__":
    main()
