"""Small, explicit mechanisms for residual paths, normalization and derivatives."""

import math

TOWER_IDS = {"residual", "normalization", "block", "backprop"}
BLOCK_ORDER = ["norm-attention", "attention", "add-attention", "norm-ffn", "ffn", "add-ffn"]


def tower_mechanics(node, stage, s):
    if node == "residual":
        result = [x + s.weight if s.reuse else s.weight for x in [1, 2, 3]]
        valid = s.reuse and abs(s.weight - [.5, -1, 0][stage]) < 1e-6 and (stage != 2 or s.reason == "identity-path")
        return [s.weight, *result], valid
    if node == "normalization":
        values = [x + s.amount for x in s.inputs]
        mean = sum(values) / 3
        variance = sum((x - mean) ** 2 for x in values) / 3
        result = [(x - mean) / math.sqrt(variance + 1e-5) for x in values] if s.position_enabled else values
        expected = [2, 2, 2] if stage == 2 else [1, 2, 3]
        valid = s.position_enabled and s.inputs == expected and (stage != 1 or s.amount == 2) and (stage != 2 or s.reason == "feature-axis")
        return [mean, variance, *result], valid
    if node == "block":
        expected = BLOCK_ORDER[:3] if stage == 0 else BLOCK_ORDER
        return [len(s.chain), *[BLOCK_ORDER.index(item) for item in s.chain]], s.chain == expected and (stage != 2 or s.reason == "pre-norm")
    if node == "backprop":
        prediction = 2 * s.weight
        error = prediction - 3
        local = 2 * error
        valid = s.weight == [1, 2, 1.5][stage] and s.local_slope == local and (stage != 2 or s.reason == "chain-product")
        return [prediction, error ** 2, local, 2, 2 * local, 2 * s.local_slope], valid
    raise ValueError("Unknown tower mechanism")
