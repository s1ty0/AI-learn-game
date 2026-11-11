import hashlib
import json
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from .models import ContentRelease, EntityRevision, RelationRevision, LearnerGraph, GraphSnapshot, AdventureSession, Account

ROOT = Path(__file__).resolve().parents[3]
CONTENT_ROOT = Path(__file__).resolve().parents[1] / ".vercel-content"
if not CONTENT_ROOT.is_dir():
    CONTENT_ROOT = ROOT
DEMO_GRAPH = "local-demo"


def read_catalog(kind):
    return json.loads((CONTENT_ROOT / f"data/catalog/{kind}.json").read_text(encoding="utf-8"))


def seed(session):
    # Cold starts can overlap. Keep release and initial graph creation atomic
    # across processes; the lock is released by this transaction's commit.
    session.execute(text("SELECT pg_advisory_xact_lock(1095522625)"))
    catalog = read_catalog("entities")
    relations = read_catalog("relations")
    module_dir = CONTENT_ROOT / "knowledge/zh-CN/transformer"
    lessons = {name: (module_dir / name).read_text(encoding="utf-8") for name in
               ["README.md", "input-and-position.md", "multihead-and-mask.md", "block-components.md", "training-and-generation.md", "missions.md"]}
    task_source = json.loads((CONTENT_ROOT / "data/quests/transformer.json").read_text(encoding="utf-8"))
    prism_lesson = (module_dir / "prism-island.md").read_text(encoding="utf-8")
    chapter = json.loads((CONTENT_ROOT / "data/games/information-sea.json").read_text(encoding="utf-8"))
    chapter_lesson = (module_dir / "information-sea.md").read_text(encoding="utf-8")
    expedition = json.loads((CONTENT_ROOT / "data/games/expedition.json").read_text(encoding="utf-8"))
    expedition_lessons = {name: (CONTENT_ROOT / "knowledge/zh-CN/expedition" / name).read_text(encoding="utf-8") for name in ["representation.md", "learning.md", "generation.md", "tower.md", "optimization.md", "decoding.md", "architecture.md", "generalization.md"]}
    # A release pins relevant lesson/task text as well as the graph catalogs.
    digest = hashlib.sha256(json.dumps([catalog, relations, lessons, task_source, prism_lesson, chapter, chapter_lesson, expedition, expedition_lessons], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
    release_id = f"{catalog['dataset_version']}+{digest}"
    if session.get(ContentRelease, release_id) is None:
        session.add(ContentRelease(id=release_id, manifest={"version": catalog["dataset_version"], "digest": digest, "status": "draft", "lessons": lessons, "task_source": task_source, "prism_lesson": prism_lesson, "chapter": chapter, "chapter_lesson": chapter_lesson, "expedition": expedition, "expedition_lessons": expedition_lessons}))
        session.flush()
        session.add_all(EntityRevision(release_id=release_id, entity_id=e["id"], data=e) for e in catalog["items"])
        session.add_all(RelationRevision(release_id=release_id, relation_id=r["id"], source_id=r["from_id"], target_id=r["to_id"], data=r) for r in relations["items"])
        session.flush()
    seed_learner(session,release_id,DEMO_GRAPH,"local-demo")
    for graph_id in session.scalars(select(Account.graph_id).where(Account.graph_id!=DEMO_GRAPH)):
        seed_progress(session,release_id,graph_id,expedition)
    session.commit()
    return release_id


def seed_learner(session,release_id,graph_id,owner):
    expedition=session.get(ContentRelease,release_id).manifest["expedition"]
    if session.get(LearnerGraph, graph_id) is None:
        wanted = [("token", 0, 30, "输入单位", "input"), ("词嵌入", 245, 30, "向量表示", "input"),
                  ("Transformer", 490, 185, "计算主干", "model"), ("因果掩码", 245, 230, "信息边界", "focus"),
                  ("logits", 490, 380, "输出分数", "output"), ("交叉熵", 245, 435, "训练目标", "output"),
                  ("梯度下降", 0, 435, "参数更新", "training")]
        entities=session.scalars(select(EntityRevision).where(EntityRevision.release_id==release_id)).all()
        by_name = {row.data["name"]:row.data for row in entities}
        nodes = [{"id": by_name[name]["id"], "type": "knowledge", "position": {"x": x, "y": y},
                  "data": {"label": name, "subtitle": subtitle, "category": category, "note": ""}}
                 for name, x, y, subtitle, category in wanted]
        edges = []
        for a, b, label in [("token", "词嵌入", "查表表示"), ("词嵌入", "Transformer", "输入"),
                             ("因果掩码", "Transformer", "限制访问"), ("Transformer", "logits", "输出"),
                             ("logits", "交叉熵", "参与计算"), ("交叉熵", "梯度下降", "目标经梯度影响更新")]:
            edges.append({"id": f"seed-{len(edges)+1}", "source": by_name[a]["id"], "target": by_name[b]["id"], "label": label})
        session.add(LearnerGraph(id=graph_id, owner=owner, revision=0))
        session.flush()
        session.add(GraphSnapshot(graph_id=graph_id, revision=0, release_id=release_id,
                                  payload={"nodes": nodes, "edges": edges}, note="初始探索图 · 关系待学习验证"))
    seed_progress(session,release_id,graph_id,expedition)


def seed_progress(session,release_id,graph_id,expedition):
    nodes=["mask","prism","query","heads","beacon",*[item["id"] for item in expedition["nodes"]]]
    rows=[{"id":graph_id if node=="mask" else f"{graph_id}:{node}","release_id":release_id,
           "revision":0,"stage":0,"events":[]} for node in nodes]
    session.execute(insert(AdventureSession).values(rows).on_conflict_do_nothing())
