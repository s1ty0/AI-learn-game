"""Check module, source, file, practice and independent rubric references."""

import json

from check_catalog import ROOT, load_catalog


def validate_topic(topic, practices, assessments, catalog, root=ROOT):
    entities = {e["id"] for e in catalog["entities"]}
    sources = {s["id"] for s in catalog["sources"] if s["access_status"] != "unavailable"}
    if topic["entity_id"] not in entities:
        raise ValueError("Unknown topic entity")

    def file_exists(value):
        path = (root / value).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            raise ValueError(f"Invalid topic file: {value}")

    for path in [topic["entry_path"], topic["example_path"], topic["practice_path"], topic["assessment_path"], *topic["assets"]]:
        file_exists(path)
    module_ids = set()
    for module in topic["modules"]:
        if module["id"] in module_ids:
            raise ValueError("Duplicate module ID")
        module_ids.add(module["id"])
        if not set(module["entity_ids"]) <= entities or not set(module["source_ids"]) <= sources:
            raise ValueError("Unknown module entity or unavailable source")
        file_exists(module["path"])
    question_ids = set()
    covered_modules = set()
    for document, expected_kind in [(practices, "practice"), (assessments, "assessment")]:
        if document["topic_id"] != topic["id"] or document["kind"] != expected_kind:
            raise ValueError("Wrong task topic or role")
        for item in document["items"]:
            if item["id"] in question_ids:
                raise ValueError("Task identity reused across files")
            question_ids.add(item["id"])
            if not set(item["entity_ids"]) <= entities:
                raise ValueError("Unknown task entity")
            refs = [item["module_id"]] if expected_kind == "practice" else item["module_ids"] + item["remediation_module_ids"]
            if not set(refs) <= module_ids:
                raise ValueError("Unknown task or remediation module")
            covered_modules.update(refs)
            if item["status"] != "draft":
                raise ValueError("Unreviewed task cannot become a released assessment")
            if expected_kind == "assessment" and (not item["required_points"] or not item["critical_errors"]):
                raise ValueError("Independent challenge requires reviewable rubric")
    if covered_modules != module_ids:
        raise ValueError("Module has no task mapping")


def read_inputs():
    read = lambda path: json.loads((ROOT / path).read_text(encoding="utf-8"))
    topic = read("data/topics/transformer.json")
    return topic, read(topic["practice_path"]), read(topic["assessment_path"]), load_catalog(ROOT / "data/catalog")


if __name__ == "__main__":
    topic, practice, assessment, catalog = read_inputs()
    validate_topic(topic, practice, assessment, catalog)
    print(f"PASS: {len(topic['modules'])} modules, {len(practice['items'])} practice drafts, {len(assessment['items'])} independent rubric drafts.")
