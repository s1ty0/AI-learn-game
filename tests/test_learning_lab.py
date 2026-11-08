import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "examples"))
from learning_lab import (attention, central_difference, cross_entropy, quadratic_trace,
                          scaled_regularization_step, stable_softmax, apply_toy_merges)


class LearningLabTests(unittest.TestCase):
    def test_quadratic_step_and_convergence_boundaries(self):
        self.assertEqual(quadratic_trace(learning_rate=0.5, steps=1)[-1]["parameter"], 3)
        oscillating = quadratic_trace(learning_rate=1, steps=8)
        self.assertTrue(all(row["data_loss"] == 4 for row in oscillating))
        diverging = quadratic_trace(learning_rate=1.1, steps=8)
        self.assertGreater(diverging[-1]["data_loss"], diverging[0]["data_loss"])

    def test_regularized_solution_matches_analytic_optimum(self):
        result = quadratic_trace(strength=2, steps=80)[-1]
        self.assertAlmostEqual(result["parameter"], 6 / (2 + 2), places=10)

    def test_finite_difference_matches_independent_symbolic_derivative(self):
        function = lambda p: (p[0] - 2)**2 + 3 * (p[1] + 1)**2
        gradient = central_difference(function, [0, 0])
        self.assertAlmostEqual(gradient[0], -4, places=7)
        self.assertAlmostEqual(gradient[1], 6, places=7)

    def test_softmax_offset_invariance_and_normalization(self):
        scores = [0, math.log(3)]
        for weights in (stable_softmax(scores), stable_softmax([s + 1000 for s in scores])):
            self.assertAlmostEqual(weights[0], 0.25, places=12)
            self.assertAlmostEqual(sum(weights), 1)

    def test_cross_entropy_gradient_by_independent_numerical_check(self):
        scores = [0, math.log(3)]
        gradient = central_difference(lambda z: cross_entropy(z, 1), scores)
        self.assertAlmostEqual(gradient[0], 0.25, places=7)
        self.assertAlmostEqual(gradient[1], -0.25, places=7)
        self.assertAlmostEqual(cross_entropy(scores, 1), -math.log(0.75))

    def test_cross_entropy_extreme_logit_stability(self):
        self.assertAlmostEqual(cross_entropy([1000, 1001], 1), cross_entropy([0, 1], 1))
        self.assertTrue(math.isfinite(cross_entropy([1000, -1000], 1)))

    def test_coupled_and_decoupled_equivalent_only_for_identity_scale_in_example(self):
        identity = scaled_regularization_step([1, 2], [3, 4], [1, 1], 0.1, 0.2)
        for a, b in zip(identity["coupled_l2"], identity["decoupled_decay"]):
            self.assertAlmostEqual(a, b)
        nonidentity = scaled_regularization_step([1, 1], [0, 0], [1, 0.1], 0.1, 0.2)
        self.assertNotEqual(nonidentity["coupled_l2"], nonidentity["decoupled_decay"])

    def test_attention_full_numeric_example(self):
        result = attention([[1]], [[0], [math.log(3)]], [[2], [6]])
        self.assertAlmostEqual(result["outputs"][0][0], 5)
        self.assertAlmostEqual(sum(result["weights"][0]), 1)

    def test_mask_blocks_future_values(self):
        args = ([[1], [1]], [[0], [math.log(3)]])
        mask = [[True, False], [True, True]]
        first = attention(*args, [[2], [6]], mask)
        modified = attention(*args, [[2], [600]], mask)
        self.assertEqual(first["outputs"][0], modified["outputs"][0])
        self.assertNotEqual(first["outputs"][1], modified["outputs"][1])

    def test_attention_shape_and_all_masked_rejected(self):
        with self.assertRaises(ValueError):
            attention([[1, 2]], [[1]], [[1]])
        with self.assertRaises(ValueError):
            attention([[1]], [[1]], [[1]], [[False]])

    def test_toy_merges_do_not_claim_real_tokenizer_behavior(self):
        self.assertEqual(apply_toy_merges("lower", [("l", "o"), ("lo", "w")]), ["low", "e", "r"])


if __name__ == "__main__":
    unittest.main()
