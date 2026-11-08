import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from check_catalog import load_catalog, validate


class CatalogIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.catalog = {
            "domains": [{"id": "d1"}], "sources": [{"id": "s1"}], "backlog": [],
            "entities": [{"id": name, "name": name, "domain_ids": ["d1"],
                          "content_status": "candidate", "source_links": []} for name in ["a", "b"]],
            "relations": [{"id": "r1", "from_id": "a", "to_id": "b",
                           "relation_type": "related_to", "conditions": "specific scope",
                           "source_ids": ["s1"], "review_status": "proposed",
                           "reviewed_by": None, "reviewed_on": None, "hard_prerequisite": False}],
        }

    def test_current_catalog_integrity(self):
        validate(load_catalog(ROOT / "data/catalog"))

    def test_unknown_relation_endpoint_rejected(self):
        self.catalog["relations"][0]["to_id"] = "missing"
        with self.assertRaisesRegex(ValueError, "Unknown relation endpoint"):
            validate(self.catalog)

    def test_unknown_source_rejected(self):
        self.catalog["relations"][0]["source_ids"] = ["missing"]
        with self.assertRaisesRegex(ValueError, "Unknown relation source"):
            validate(self.catalog)

    def test_claimed_source_registration_requires_source(self):
        self.catalog["entities"][0]["content_status"] = "source_registered"
        with self.assertRaisesRegex(ValueError, "without source"):
            validate(self.catalog)

    def test_reviewed_relation_requires_evidence(self):
        self.catalog["relations"][0]["review_status"] = "reviewed"
        with self.assertRaisesRegex(ValueError, "Missing relation review evidence"):
            validate(self.catalog)

    def test_proposal_cannot_unlock_learning(self):
        self.catalog["relations"][0].update(relation_type="prerequisite", hard_prerequisite=True)
        with self.assertRaisesRegex(ValueError, "Unreviewed hard prerequisite"):
            validate(self.catalog)

    def test_ordinary_knowledge_cycles_allowed(self):
        inverse = copy.deepcopy(self.catalog["relations"][0])
        inverse.update(id="r2", from_id="b", to_id="a")
        self.catalog["relations"].append(inverse)
        validate(self.catalog)

    def test_reviewed_hard_prerequisite_cycle_rejected(self):
        forward = self.catalog["relations"][0]
        forward.update(relation_type="prerequisite", hard_prerequisite=True,
                       review_status="reviewed", reviewed_by="test reviewer", reviewed_on="2026-11-07")
        inverse = copy.deepcopy(forward)
        inverse.update(id="r2", from_id="b", to_id="a")
        self.catalog["relations"].append(inverse)
        with self.assertRaisesRegex(ValueError, "Hard prerequisite cycle"):
            validate(self.catalog)

    def test_pending_source_cannot_support_reviewed_entity(self):
        self.catalog["entities"][0].update(
            content_status="reviewed", reviewed_by="test reviewer", reviewed_on="2026-11-07",
            source_links=[{"source_id": "s1", "locator": "abstract", "review_status": "pending"}])
        with self.assertRaisesRegex(ValueError, "No reviewed source link"):
            validate(self.catalog)


if __name__ == "__main__":
    unittest.main()
