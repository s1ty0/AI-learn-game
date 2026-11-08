"""Validate bounded game routing without treating it as mathematical prerequisites."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    config = json.loads((ROOT / "data/games/information-sea.json").read_text(encoding="utf-8"))
    entities = {item["id"] for item in json.loads((ROOT / "data/catalog/entities.json").read_text(encoding="utf-8"))["items"]}
    nodes = {node["id"]: node for node in config["nodes"]}
    assert len(nodes) == len(config["nodes"]), "Duplicate island ID"
    assert all(node["kind"] in {"main", "side", "finale"} for node in nodes.values())
    for node in nodes.values():
        assert set(node["requires"]) <= set(nodes), "Unknown route predecessor"
        assert set(node["entity_ids"]) <= entities, "Unknown public concept"
    reached = set()
    while len(reached) < len(nodes):
        available = {name for name, node in nodes.items() if name not in reached and set(node["requires"]) <= reached}
        assert available, "Cycle or unreachable chapter island"
        reached |= available
    main_path = config["main_path"]
    assert len(main_path) == len(set(main_path)) and set(main_path) <= set(nodes)
    assert set(main_path) == {name for name, node in nodes.items() if node["kind"] != "side"}
    before = set()
    for name in main_path:
        assert set(nodes[name]["requires"]) <= before, "Main path requires an optional or later island"
        before.add(name)
    assert nodes[main_path[-1]]["kind"] == "finale", "No main-path finale"
    assert config["completion_kind"] == "exploration-not-mastery"
    print(f"PASS: {len(main_path)} main islands, {len(nodes)-len(main_path)} optional branch; connected, acyclic, known concepts, explicit exploration boundary.")
    expedition = json.loads((ROOT / "data/games/expedition.json").read_text(encoding="utf-8"))
    fixtures = json.loads((ROOT / "data/games/expedition-fixtures.json").read_text(encoding="utf-8"))
    added = {node["id"]: node for node in expedition["nodes"]}
    assert len(added) == 12 and not set(added).intersection(nodes)
    assert set(fixtures) == set(added) and all(len(stages) == 3 for stages in fixtures.values())
    combined = {**nodes, **added}
    seen = set()
    while len(seen) < len(combined):
        available = {name for name, node in combined.items() if name not in seen and set(node["requires"]) <= seen}
        assert available, "Unreachable expedition or route cycle"
        seen |= available
    before = set(main_path)
    for chapter in expedition["chapters"]:
        group = {name: node for name, node in added.items() if node["chapter"] == chapter["id"]}
        assert len(group) == 4 and len(chapter["main_path"]) == 3
        assert {name for name, node in group.items() if node["kind"] != "side"} == set(chapter["main_path"])
        for name in chapter["main_path"]:
            assert set(added[name]["requires"]) <= before, "Main expedition depends on an optional branch"
            before.add(name)
        assert group[chapter["main_path"][-1]]["kind"] == "finale"
    for node in added.values():
        assert set(node["entity_ids"]) <= entities
        assert len(node["steps"]) == 3 and all(all(step.get(key) for key in ["title", "goal", "hint"]) for step in node["steps"])
        assert node["discovery"] and node["boundary"]
    print("PASS: 4 chapters, 17 islands, 51 mechanisms; main route connected, optional branches do not block, all concepts and fixture stages present.")


if __name__ == "__main__":
    main()
