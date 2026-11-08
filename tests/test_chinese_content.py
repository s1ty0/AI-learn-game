import copy
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from check_catalog import load_catalog
from check_chinese_content import validate_content


class ChineseContentTests(unittest.TestCase):
    def setUp(self):
        self.index = json.loads((ROOT / "data/content/zh-CN/index.json").read_text(encoding="utf-8"))
        self.catalog = load_catalog(ROOT / "data/catalog")

    def test_current_chinese_content(self):
        self.assertEqual(validate_content(self.index, self.catalog), (8, 16))

    def test_unknown_article_entity_rejected(self):
        self.index["articles"][0]["entity_id"] = "missing"
        with self.assertRaisesRegex(ValueError, "Unknown article reference"):
            validate_content(self.index, self.catalog)

    def test_unknown_glossary_source_rejected(self):
        self.index["glossary"][0]["source_ids"] = ["missing"]
        with self.assertRaisesRegex(ValueError, "Unknown glossary reference"):
            validate_content(self.index, self.catalog)

    def test_content_cannot_escape_knowledge_directory(self):
        self.index["articles"][0]["path"] = "AGENT.md"
        with self.assertRaisesRegex(ValueError, "outside Chinese content"):
            validate_content(self.index, self.catalog)

    def test_duplicate_identity_rejected(self):
        self.index["articles"].append(copy.deepcopy(self.index["articles"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate article"):
            validate_content(self.index, self.catalog)

    def test_first_mention_requires_explanation(self):
        self.index["glossary"][0]["first_mention"] = "unexplained term"
        with self.assertRaisesRegex(ValueError, "first-mention Chinese explanation"):
            validate_content(self.index, self.catalog)

    def test_unknown_depth_source_rejected(self):
        self.index["articles"][0]["depth_source_ids"] = ["missing"]
        with self.assertRaisesRegex(ValueError, "Unknown depth source"):
            validate_content(self.index, self.catalog)

    def test_depth_file_cannot_escape_directory(self):
        self.index["articles"][0]["depth_path"] = "PLAN.md"
        with self.assertRaisesRegex(ValueError, "Depth path outside"):
            validate_content(self.index, self.catalog)

    def test_draft_must_publish_remaining_gaps(self):
        self.index["articles"][0]["open_gaps"] = []
        with self.assertRaisesRegex(ValueError, "explicit gaps"):
            validate_content(self.index, self.catalog)

    def test_original_example_arithmetic(self):
        # Guard the concrete author-created samples, not a general optimizer implementation.
        theta, eta = 1.0, 0.1
        gradient = 2 * (theta - 3)
        updated = theta - eta * gradient
        self.assertAlmostEqual(updated, 1.4)
        self.assertAlmostEqual((updated - 3) ** 2, 2.56)
        self.assertAlmostEqual(1 + 0.2 / 2 * 1 ** 2, 1.1)
        self.assertAlmostEqual(1 + 0.2 / 2 * 3 ** 2, 1.9)
        self.assertEqual(0.25 * 2 + 0.75 * 6, 5)
        self.assertAlmostEqual(-math.log(0.8), 0.223, places=3)
        self.assertAlmostEqual(-math.log(0.2), 1.609, places=3)


if __name__ == "__main__":
    unittest.main()
