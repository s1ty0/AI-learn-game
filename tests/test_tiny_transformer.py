import sys
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "examples"))
from tiny_transformer import TinyDecoder, language_loss, shifted_batch, demo


class TinyTransformerTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(7)
        torch.set_num_threads(1)
        self.model = TinyDecoder().eval()

    def test_shifted_targets_are_next_symbol(self):
        inputs, targets = shifted_batch(torch.tensor([[1, 2, 3, 4]]))
        self.assertEqual(inputs.tolist(), [[1, 2, 3]])
        self.assertEqual(targets.tolist(), [[2, 3, 4]])

    def test_parameter_ledger_matches_model(self):
        # Embedding + attention projections + FFN + 3 LayerNorms + output head.
        expected = 7 * 8 + 4 * 8 * 8 + (8 * 16 + 16 + 16 * 8 + 8) + 3 * 2 * 8 + 8 * 7
        self.assertEqual(expected, 696)
        self.assertEqual(sum(p.numel() for p in self.model.parameters()), expected)

    def test_ffn_does_not_mix_positions(self):
        inputs = torch.randn(1, 3, 8)
        changed = inputs.clone()
        changed[:, 2] += 7
        torch.testing.assert_close(self.model.ffn(inputs)[:, :2], self.model.ffn(changed)[:, :2])

    def test_layernorm_does_not_depend_on_other_batch_samples(self):
        inputs = torch.randn(2, 3, 8)
        changed = inputs.clone()
        changed[1] *= 100
        torch.testing.assert_close(self.model.norm_attention(inputs)[0], self.model.norm_attention(changed)[0])

    def test_shapes_and_no_future_access(self):
        _, weights, shapes = self.model(torch.tensor([[1, 2, 3]]))
        self.assertEqual(shapes["q_per_head"], [1, 2, 3, 4])
        self.assertEqual(shapes["logits"], [1, 3, 7])
        self.assertTrue(torch.equal(weights.triu(1), torch.zeros_like(weights)))
        torch.testing.assert_close(weights.sum(-1), torch.ones(1, 2, 3))

    def test_changing_future_symbols_does_not_change_prefix_logits(self):
        first = self.model(torch.tensor([[1, 2, 3, 4]]))[0]
        changed = self.model(torch.tensor([[1, 2, 5, 6]]))[0]
        torch.testing.assert_close(first[:, :2], changed[:, :2])

    def test_padding_exclusion_is_distinct_from_loss_ignore(self):
        logits, weights, _ = self.model(torch.tensor([[1, 2, 0]]), torch.tensor([[False, False, True]]))
        self.assertTrue(torch.equal(weights[..., 2], torch.zeros_like(weights[..., 2])))
        labels = torch.tensor([[2, 3, -100]])
        reference = language_loss(logits[:, :2], labels[:, :2])
        torch.testing.assert_close(language_loss(logits, labels), reference)

    def test_training_graph_reaches_every_parameter(self):
        inputs, labels = shifted_batch(torch.tensor([[1, 2, 3, 4]]))
        language_loss(self.model(inputs)[0], labels).backward()
        for name, parameter in self.model.named_parameters():
            self.assertIsNotNone(parameter.grad, name)
            self.assertTrue(torch.isfinite(parameter.grad).all(), name)

    def test_invalid_training_and_mask_cases_rejected(self):
        with self.assertRaises(ValueError):
            language_loss(torch.zeros(1, 2, 7), torch.full((1, 2), -100))
        with self.assertRaises(ValueError):
            self.model(torch.tensor([[0, 0]]), torch.tensor([[True, True]]))
        with self.assertRaises(ValueError):
            TinyDecoder(width=8, heads=3)

    def test_seeded_demo_can_fit_synthetic_training_pattern(self):
        result = demo()
        self.assertLess(result["training_loss_after"], result["training_loss_before"] / 3)
        self.assertEqual(result["first_prediction_ids"], result["first_label_ids"])
        # This checks a controlled training example, not real-world generalization.


if __name__ == "__main__":
    unittest.main()
