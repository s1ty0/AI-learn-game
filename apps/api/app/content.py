import hashlib
import json
from pathlib import Path

from sqlalchemy import select

from .models import ContentRelease, EntityRevision, RelationRevision, LearnerGraph, GraphSnapshot, AdventureSession

ROOT = Path(__file__).resolve().parents[3]
DEMO_GRAPH = "local-demo"


def read_catalog(kind):
    return json.loads((ROOT / f"data/catalog/{kind}.json").read_text(encoding="utf-8"))


def seed(session):
    catalog = read_catalog("entities")
    relations = read_catalog("relations")
    module_dir = ROOT / "knowledge/zh-CN/transformer"
    lessons = {name: (module_dir / name).read_text(encoding="utf-8") for name in
               ["README.md", "input-and-position.md", "multihead-and-mask.md", "block-components.md", "training-and-generation.md", "missions.md"]}
    task_source = json.loads((ROOT / "data/quests/transformer.json").read_text(encoding="utf-8"))
    prism_lesson = (module_dir / "prism-island.md").read_text(encoding="utf-8")
    chapter = json.loads((ROOT / "data/games/information-sea.json").read_text(encoding="utf-8"))
    chapter_lesson = (module_dir / "information-sea.md").read_text(encoding="utf-8")
    expedition = json.loads((ROOT / "data/games/expedition.json").read_text(encoding="utf-8"))
    expedition_lessons = {name: (ROOT / "knowledge/zh-CN/expedition" / name).read_text(encoding="utf-8") for name in ["representation.md", "learning.md", "generation.md", "tower.md"]}
    # A release pins relevant lesson/task text as well as the graph catalogs.
    digest = hashlib.sha256(json.dumps([catalog, relations, lessons, task_source, prism_lesson, chapter, chapter_lesson, expedition, expedition_lessons], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
    release_id = f"{catalog['dataset_version']}+{digest}"
    if session.get(ContentRelease, release_id) is None:
        session.add(ContentRelease(id=release_id, manifest={"version": catalog["dataset_version"], "digest": digest, "status": "draft", "lessons": lessons, "task_source": task_source, "prism_lesson": prism_lesson, "chapter": chapter, "chapter_lesson": chapter_lesson, "expedition": expedition, "expedition_lessons": expedition_lessons}))
        session.flush()
        session.add_all(EntityRevision(release_id=release_id, entity_id=e["id"], data=e) for e in catalog["items"])
        session.add_all(RelationRevision(release_id=release_id, relation_id=r["id"], source_id=r["from_id"], target_id=r["to_id"], data=r) for r in relations["items"])
        session.flush()
    if session.get(LearnerGraph, DEMO_GRAPH) is None:
        wanted = [("token", 0, 30, "输入单位", "input"), ("词嵌入", 245, 30, "向量表示", "input"),
                  ("Transformer", 490, 185, "计算主干", "model"), ("因果掩码", 245, 230, "信息边界", "focus"),
                  ("logits", 490, 380, "输出分数", "output"), ("交叉熵", 245, 435, "训练目标", "output"),
                  ("梯度下降", 0, 435, "参数更新", "training")]
        by_name = {e["name"]: e for e in catalog["items"]}
        nodes = [{"id": by_name[name]["id"], "type": "knowledge", "position": {"x": x, "y": y},
                  "data": {"label": name, "subtitle": subtitle, "category": category, "note": ""}}
                 for name, x, y, subtitle, category in wanted]
        edges = []
        for a, b, label in [("token", "词嵌入", "查表表示"), ("词嵌入", "Transformer", "输入"),
                             ("因果掩码", "Transformer", "限制访问"), ("Transformer", "logits", "输出"),
                             ("logits", "交叉熵", "参与计算"), ("交叉熵", "梯度下降", "目标经梯度影响更新")]:
            edges.append({"id": f"seed-{len(edges)+1}", "source": by_name[a]["id"], "target": by_name[b]["id"], "label": label})
        session.add(LearnerGraph(id=DEMO_GRAPH, owner="local-demo", revision=0))
        session.flush()
        session.add(GraphSnapshot(graph_id=DEMO_GRAPH, revision=0, release_id=release_id,
                                  payload={"nodes": nodes, "edges": edges}, note="初始探索图 · 关系待学习验证"))
    if session.get(AdventureSession, DEMO_GRAPH) is None:
        session.add(AdventureSession(id=DEMO_GRAPH, release_id=release_id, revision=0, stage=0, events=[]))
    if session.get(AdventureSession, DEMO_GRAPH + ":prism") is None:
        session.add(AdventureSession(id=DEMO_GRAPH + ":prism", release_id=release_id, revision=0, stage=0, events=[]))
    for node in ["query", "heads", "beacon", *[item["id"] for item in expedition["nodes"]]]:
        if session.get(AdventureSession, DEMO_GRAPH + ":" + node) is None:
            session.add(AdventureSession(id=DEMO_GRAPH + ":" + node, release_id=release_id, revision=0, stage=0, events=[]))
    session.commit()
    return release_id
