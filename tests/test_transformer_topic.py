import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_transformer_topic import read_inputs, validate_topic


class TopicDataTests(unittest.TestCase):
    def setUp(self):
        self.topic, self.practice, self.assessment, self.catalog = read_inputs()

    def test_current_topic_references(self):
        validate_topic(self.topic, self.practice, self.assessment, self.catalog)

    def test_remediation_must_resolve(self):
        self.assessment["items"][0]["remediation_module_ids"] = ["missing"]
        with self.assertRaisesRegex(ValueError, "Unknown task or remediation"):
            validate_topic(self.topic, self.practice, self.assessment, self.catalog)

    def test_draft_cannot_claim_release(self):
        self.assessment["items"][0]["status"] = "released"
        with self.assertRaisesRegex(ValueError, "Unreviewed task"):
            validate_topic(self.topic, self.practice, self.assessment, self.catalog)

    def test_independent_challenge_requires_rubric(self):
        self.assessment["items"][0]["required_points"] = []
        with self.assertRaisesRegex(ValueError, "reviewable rubric"):
            validate_topic(self.topic, self.practice, self.assessment, self.catalog)


if __name__ == "__main__":
    unittest.main()
