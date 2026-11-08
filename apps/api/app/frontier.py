"""Bounded modern-block and evaluation-boundary teaching mechanisms."""

import math

FRONTIER_IDS = {"rmsnorm", "rope", "gqa", "swiglu", "split", "leakage", "overfit", "schedule"}


def norm_values(scale, shift, kind):
    values = [scale + shift, 2 * scale + shift]
    mean = sum(values) / 2
    rms = math.sqrt(sum(x*x for x in values) / 2 + 1e-5)
    deviation = math.sqrt(sum((x-mean)**2 for x in values) / 2 + 1e-5)
    normalized = [x/rms for x in values]
    centered = [(x-mean)/deviation for x in values]
    output = normalized if kind == "rms" else centered if kind == "layer" else values
    return [mean, rms, *normalized, *centered, *output]


def rope_values(query, key, enabled):
    q, k = (query * math.pi/4, key * math.pi/4) if enabled else (0., 0.)
    qx, qy, kx, ky = math.cos(q), math.sin(q), math.cos(k), math.sin(k)
    return [qx, qy, kx, ky, qx*kx+qy*ky, key-query]


def gqa_values(heads):
    group_size = 4 // heads
    mapping = [i // group_size for i in range(4)]
    outputs = []
    for i, query in enumerate([1., 2., -1., -2.]):
        anchor = mapping[i] * group_size
        first_value = 2 + 2 * anchor
        probability = 1 / (1 + math.exp(-query))
        outputs.append(probability * first_value + (1-probability) * (first_value+4))
    return [4, heads, 4*heads, *mapping, *outputs]


def split_values(partitions):
    counts = [partitions.count(i) for i in range(3)]
    leaks = sum(partitions[2*i] != partitions[2*i+1] for i in range(3))
    return [*counts, leaks, *partitions]


def curve_prediction(x, curvature):
    return x + curvature * (x*x-1)


def schedule_rate(step):
    return .1 * step / 2 if step <= 2 else .1 * max(0, 6-step) / 4


def frontier_mechanics(node, stage, s):
    if node == "rmsnorm":
        valid = s.norm_kind == "rms" and s.feature_scale == (2 if stage == 1 else 1) and s.feature_shift == (2 if stage == 2 else 0) and (stage != 2 or s.reason == "rms-not-center")
        return norm_values(s.feature_scale, s.feature_shift, s.norm_kind), valid
    if node == "rope":
        valid = s.rotation_enabled and [s.query_position, s.key_position] == [[0, 1], [2, 3], [2, 4]][stage] and (stage != 2 or s.reason == "relative-phase")
        return rope_values(s.query_position, s.key_position, s.rotation_enabled), valid
    if node == "gqa":
        valid = s.kv_heads == [4, 2, 1][stage] and s.steps == 1 and (stage != 2 or s.reason == "share-kv")
        return gqa_values(s.kv_heads), valid
    if node == "swiglu":
        a, b = s.gate_input, s.branch_input
        sigmoid = 1 / (1 + math.exp(-a))
        valid = a == [1, -2, 1][stage] and b == [2, 2, -1][stage] and (stage != 2 or s.reason == "gated-product")
        return [a, sigmoid, a*sigmoid, b, a*sigmoid*b], valid
    if node == "split":
        metrics = split_values(s.partitions)
        valid = metrics[:3] == [2, 2, 2] and (stage == 0 or metrics[3] == 0) and (stage != 2 or s.reason == "group-boundaries")
        return metrics, valid
    if node == "leakage":
        high = 2. if s.fit_scope == "train" else s.held_out
        valid = s.fit_scope == "train" and (stage != 1 or s.held_out == 200) and (stage != 2 or s.reason == "train-only-fit")
        return [0., high, 0., 2/high, s.held_out/high], valid
    if node == "overfit":
        train = [curve_prediction(x, s.curvature) for x in [-1., 1.]]
        validation = [curve_prediction(x, s.curvature) for x in [0., .5]]
        train_loss = sum((p-y)**2 for p, y in zip(train, [-1., 1.])) / 2
        validation_loss = sum((p-y)**2 for p, y in zip(validation, [0., .5])) / 2
        valid = s.curvature == (2 if stage == 1 else 0) and (stage != 2 or s.reason == "validation-selection")
        return [train_loss, validation_loss, *train, *validation], valid
    if node == "schedule":
        valid = s.steps == [1, 2, 6][stage] and (stage != 2 or s.reason == "rate-schedule")
        return [schedule_rate(s.steps), *[schedule_rate(i) for i in range(min(s.steps, 6)+1)]], valid
    raise ValueError("Unknown frontier mechanism")
