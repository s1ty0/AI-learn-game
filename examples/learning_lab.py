"""Small deterministic teaching experiments, using only Python's standard library.

These are numerical references, not a framework, a complete Transformer, or Adam.
Run: python examples/learning_lab.py
"""

import json
import math


def finite_vector(values):
    values = list(values)
    if not values or not all(math.isfinite(v) for v in values):
        raise ValueError("Expected a nonempty finite vector")
    return values


def stable_softmax(scores):
    scores = finite_vector(scores)
    maximum = max(scores)
    weights = [math.exp(score - maximum) for score in scores]
    total = sum(weights)
    return [weight / total for weight in weights]


def cross_entropy(logits, target):
    """Single class-index target, no weighting or smoothing; natural logarithm."""
    logits = finite_vector(logits)
    if not isinstance(target, int) or not 0 <= target < len(logits):
        raise ValueError("Target must be an in-range class index")
    maximum = max(logits)
    # Keep subtraction outside the large common offset to avoid cancellation.
    return math.log(sum(math.exp(z - maximum) for z in logits)) - (logits[target] - maximum)


def regression_losses(predictions, targets):
    predictions, targets = finite_vector(predictions), finite_vector(targets)
    if len(predictions) != len(targets):
        raise ValueError("Prediction and target lengths differ")
    errors = [p - t for p, t in zip(predictions, targets)]
    return {"mae": sum(abs(e) for e in errors) / len(errors),
            "mse": sum(e * e for e in errors) / len(errors)}


def quadratic_trace(initial=1.0, learning_rate=0.1, strength=0.0, steps=8):
    """J(w)=(w-3)^2 + strength/2*w^2; fixed-step, full-gradient descent."""
    if not all(math.isfinite(v) for v in (initial, learning_rate, strength)):
        raise ValueError("Parameters must be finite")
    if learning_rate <= 0 or strength < 0 or not isinstance(steps, int) or steps < 0:
        raise ValueError("Invalid rate, strength or step budget")
    parameter = initial
    trace = []
    for step in range(steps + 1):
        data_loss = (parameter - 3) ** 2
        penalty = strength / 2 * parameter ** 2
        trace.append({"step": step, "parameter": parameter, "data_loss": data_loss,
                      "penalty": penalty, "objective": data_loss + penalty})
        if step != steps:
            parameter -= learning_rate * (2 * (parameter - 3) + strength * parameter)
    return trace


def central_difference(function, point, epsilon=1e-5):
    point = finite_vector(point)
    if not math.isfinite(epsilon) or epsilon <= 0:
        raise ValueError("epsilon must be finite and positive")
    result = []
    for coordinate in range(len(point)):
        plus, minus = point.copy(), point.copy()
        plus[coordinate] += epsilon
        minus[coordinate] -= epsilon
        result.append((function(plus) - function(minus)) / (2 * epsilon))
    return result


def scaled_regularization_step(weights, data_gradient, scales, learning_rate, strength):
    """Fixed diagonal scaling counterexample; this does NOT implement Adam states."""
    weights, data_gradient, scales = map(finite_vector, (weights, data_gradient, scales))
    if not len(weights) == len(data_gradient) == len(scales):
        raise ValueError("Coordinate lengths differ")
    if not math.isfinite(learning_rate) or not math.isfinite(strength):
        raise ValueError("Rate and strength must be finite")
    if learning_rate <= 0 or strength < 0 or any(scale <= 0 for scale in scales):
        raise ValueError("Invalid rate, strength or coordinate scales")
    coupled = [w - learning_rate * d * (g + strength * w)
               for w, g, d in zip(weights, data_gradient, scales)]
    decoupled = [(1 - learning_rate * strength) * w - learning_rate * d * g
                 for w, g, d in zip(weights, data_gradient, scales)]
    return {"coupled_l2": coupled, "decoupled_decay": decoupled}


def matrix(values):
    rows = [finite_vector(row) for row in values]
    if not rows or any(len(row) != len(rows[0]) for row in rows):
        raise ValueError("Expected a nonempty rectangular matrix")
    return rows


def attention(queries, keys, values, allowed=None):
    """One head, no projections, dropout, cache or backprop. True means allowed."""
    queries, keys, values = map(matrix, (queries, keys, values))
    if len(queries[0]) != len(keys[0]) or len(keys) != len(values):
        raise ValueError("Incompatible query/key/value shapes")
    if allowed is None:
        allowed = [[True] * len(keys) for _ in queries]
    if len(allowed) != len(queries) or any(len(row) != len(keys) for row in allowed):
        raise ValueError("Mask shape must match query/key positions")
    if any(type(entry) is not bool for row in allowed for entry in row):
        raise ValueError("Mask entries must be boolean")
    outputs, all_weights = [], []
    denominator = math.sqrt(len(keys[0]))
    for query, mask in zip(queries, allowed):
        positions = [j for j, permit in enumerate(mask) if permit]
        if not positions:
            raise ValueError("A query cannot have all keys masked")
        scores = [sum(q * k for q, k in zip(query, keys[j])) / denominator for j in positions]
        visible_weights = stable_softmax(scores)
        weights = [0.0] * len(keys)
        for j, weight in zip(positions, visible_weights):
            weights[j] = weight
        outputs.append([sum(weights[j] * values[j][column] for j in range(len(keys)))
                        for column in range(len(values[0]))])
        all_weights.append(weights)
    return {"weights": all_weights, "outputs": outputs}


def apply_toy_merges(symbols, merges):
    """Apply an explicit merge list; does not learn BPE or emulate a real tokenizer."""
    symbols = list(symbols)
    for left, right in merges:
        merged, position = [], 0
        while position < len(symbols):
            if position + 1 < len(symbols) and symbols[position:position + 2] == [left, right]:
                merged.append(left + right)
                position += 2
            else:
                merged.append(symbols[position])
                position += 1
        symbols = merged
    return symbols


def main():
    scores = [0.0, math.log(3)]
    examples = {
        "loss_comparison": regression_losses([1, 1, 8], [0, 0, 0]),
        "gradient_at_origin": central_difference(lambda x: (x[0] - 2)**2 + 3 * (x[1] + 1)**2, [0, 0]),
        "descent_final_parameters": {str(rate): quadratic_trace(learning_rate=rate)[-1]["parameter"]
                                     for rate in [0.1, 0.5, 1.0, 1.1]},
        "l2_optimum": quadratic_trace(strength=2, steps=80)[-1]["parameter"],
        "scaling_counterexample_not_adam": scaled_regularization_step([1, 1], [0, 0], [1, 0.1], 0.1, 0.2),
        "attention": attention([[1]], [[0], [math.log(3)]], [[2], [6]]),
        "masked_attention": attention([[1]], [[0], [math.log(3)]], [[2], [6]], [[True, False]]),
        "cross_entropy": cross_entropy(scores, 1),
        "cross_entropy_with_offset": cross_entropy([z + 1000 for z in scores], 1),
        "toy_merge_not_real_tokenizer": apply_toy_merges("lower", [("l", "o"), ("lo", "w")]),
    }
    print(json.dumps(examples, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
