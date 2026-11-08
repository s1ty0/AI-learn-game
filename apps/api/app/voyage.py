"""Explicit optimization traces and deterministic decoding experiments."""

import math

VOYAGE_IDS = {"batch", "momentum", "adam", "clipping", "topk", "topp", "sampling", "stopping"}
PROBABILITIES = [.4, .3, .2, .1]
DRAW_POINTS = [[.05, .15, .25, .35, .45, .55, .65, .75, .85, .95], [.1, .42, .49, .52, .61, .68, .72, .94, .96, .99]]


def momentum_trace(beta, steps):
    weight, velocity, path = 0., 0., []
    for gradient in [1., 1., -1.][:steps]:
        velocity = beta * velocity + gradient
        weight -= .1 * velocity
        path.append([gradient, velocity, weight])
    return weight, velocity, path


def adam_trace(steps, corrected):
    weight, first, second, mhat, vhat = [[0., 0.] for _ in range(5)]
    for t, gradient in enumerate([[2., .2], [2., .2], [0., 0.]][:steps], 1):
        for i in range(2):
            first[i] = .9 * first[i] + .1 * gradient[i]
            second[i] = .999 * second[i] + .001 * gradient[i] ** 2
            mhat[i] = first[i] / (1 - .9 ** t) if corrected else first[i]
            vhat[i] = second[i] / (1 - .999 ** t) if corrected else second[i]
            weight[i] -= .1 * mhat[i] / (math.sqrt(vhat[i]) + 1e-8)
    return [*weight, *mhat, *vhat, *first, *second, min(steps, 3)]


def filtered(node, count, cutoff):
    keep = count
    if node == "topp":
        keep, cumulative = 0, 0.
        for probability in PROBABILITIES:
            cumulative += probability
            keep += 1
            if cumulative >= cutoff - 1e-12:
                break
    mass = sum(PROBABILITIES[:keep])
    return keep, mass, [p / mass if index < keep else 0. for index, p in enumerate(PROBABILITIES)]


def sampling_trace(draws, draw_set):
    sequence, counts = [], [0] * 4
    for point in DRAW_POINTS[draw_set][:draws]:
        cumulative = 0.
        for index, probability in enumerate(PROBABILITIES):
            cumulative += probability
            if point < cumulative:
                sequence.append(index)
                counts[index] += 1
                break
    return [draws, *counts, *sequence]


def stopping_trace(steps, eos, limit):
    sequence, ended = [0], False
    for _ in range(min(steps, limit)):
        if ended:
            break
        symbol = {0: 1, 1: 2, 2: 0}[sequence[-1]]
        sequence.append(symbol)
        ended = eos and symbol == 2
    added = len(sequence) - 1
    return [len(sequence), *sequence, int(ended), int(added >= limit), added]


def voyage_mechanics(node, stage, s):
    if node == "batch":
        rows = sorted(s.rows)
        gradients = [2., -1., -4.]
        gradient = sum(gradients[i] for i in rows) / len(rows) if rows else 0.
        weight = -.1 * gradient if s.steps else 0.
        objective = lambda w: sum((w - target) ** 2 for target in [-2., 1., 4.]) / 6
        valid = rows == [[0, 1, 2], [0, 1], [1, 2]][stage] and s.steps == 1 and (stage != 2 or s.reason == "batch-direction")
        return [len(rows), gradient, weight, objective(0), objective(weight)], valid
    if node == "momentum":
        weight, velocity, path = momentum_trace(s.momentum_beta, s.steps)
        valid = s.momentum_beta == [0, .9, .9][stage] and s.steps == [2, 2, 3][stage] and (stage != 2 or s.reason == "history-state")
        return [weight, velocity, *[value for row in path for value in row]], valid
    if node == "adam":
        valid = s.correct_bias == (stage > 0) and s.steps == (3 if stage == 2 else 1) and (stage != 2 or s.reason == "two-moments")
        return adam_trace(s.steps, s.correct_bias), valid
    if node == "clipping":
        scale = min(1., s.max_norm / 5) if s.clip_enabled else 1.
        valid = s.steps == 1 and s.clip_enabled == (stage > 0) and (stage == 0 or s.max_norm == (2 if stage == 2 else 1)) and (stage != 2 or s.reason == "preserve-direction")
        return [5., scale, 3 * scale, 4 * scale, 5 * scale], valid
    if node in {"topk", "topp"}:
        keep, mass, probabilities = filtered(node, s.keep_count, s.cutoff)
        valid = keep == ([2, 1, 3] if node == "topk" else [2, 3, 1])[stage] and (stage != 2 or s.reason == ("candidate-set" if node == "topk" else "cumulative-prefix"))
        return [keep, mass, *probabilities], valid
    if node == "sampling":
        valid = s.draws == (1 if stage == 0 else 10) and s.draw_set == (1 if stage == 2 else 0) and (stage != 2 or s.reason == "finite-observation")
        return sampling_trace(s.draws, s.draw_set), valid
    if node == "stopping":
        metrics = stopping_trace(s.steps, s.stop_enabled, s.token_limit)
        ended, capped, _ = metrics[-3:]
        valid = (s.stop_enabled and ended == 1 if stage == 0 else not s.stop_enabled and s.token_limit == 1 and capped == 1 if stage == 1 else s.stop_enabled and s.token_limit == 4 and ended == 1 and s.reason == "stop-boundaries")
        return metrics, bool(valid and s.steps == metrics[-1])
    raise ValueError("Unknown voyage mechanism")
