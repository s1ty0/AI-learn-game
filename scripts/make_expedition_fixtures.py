"""Author explicit solved configurations shared by two independent runtimes.

These are practice fixtures, not hidden independent assessments.
"""

import json
from pathlib import Path

SOLUTIONS = {
    "rmsnorm": [{"norm_kind": "rms"}, {"norm_kind": "rms", "feature_scale": 2}, {"norm_kind": "rms", "feature_shift": 2, "reason": "rms-not-center"}],
    "rope": [{"rotation_enabled": True, "query_position": 0, "key_position": 1}, {"rotation_enabled": True, "query_position": 2, "key_position": 3}, {"rotation_enabled": True, "query_position": 2, "key_position": 4, "reason": "relative-phase"}],
    "gqa": [{"kv_heads": 4, "steps": 1}, {"kv_heads": 2, "steps": 1}, {"kv_heads": 1, "steps": 1, "reason": "share-kv"}],
    "swiglu": [{"gate_input": 1, "branch_input": 2}, {"gate_input": -2, "branch_input": 2}, {"gate_input": 1, "branch_input": -1, "reason": "gated-product"}],
    "split": [{"partitions": [0,0,1,1,2,2]}, {"partitions": [0,0,1,1,2,2]}, {"partitions": [0,0,1,1,2,2], "reason": "group-boundaries"}],
    "leakage": [{"fit_scope": "train"}, {"fit_scope": "train", "held_out": 200}, {"fit_scope": "train", "held_out": 200, "reason": "train-only-fit"}],
    "overfit": [{"curvature": 0}, {"curvature": 2}, {"curvature": 0, "reason": "validation-selection"}],
    "schedule": [{"steps": 1}, {"steps": 2}, {"steps": 6, "reason": "rate-schedule"}],
    "batch": [{"rows": [0, 1, 2], "steps": 1}, {"rows": [0, 1], "steps": 1}, {"rows": [1, 2], "steps": 1, "reason": "batch-direction"}],
    "momentum": [{"momentum_beta": 0, "steps": 2}, {"momentum_beta": .9, "steps": 2}, {"momentum_beta": .9, "steps": 3, "reason": "history-state"}],
    "adam": [{"steps": 1, "correct_bias": False}, {"steps": 1, "correct_bias": True}, {"steps": 3, "correct_bias": True, "reason": "two-moments"}],
    "clipping": [{"steps": 1, "clip_enabled": False}, {"steps": 1, "clip_enabled": True, "max_norm": 1}, {"steps": 1, "clip_enabled": True, "max_norm": 2, "reason": "preserve-direction"}],
    "topk": [{"keep_count": 2}, {"keep_count": 1}, {"keep_count": 3, "reason": "candidate-set"}],
    "topp": [{"cutoff": .65}, {"cutoff": .85}, {"cutoff": .35, "reason": "cumulative-prefix"}],
    "sampling": [{"draws": 1, "draw_set": 0}, {"draws": 10, "draw_set": 0}, {"draws": 10, "draw_set": 1, "reason": "finite-observation"}],
    "stopping": [{"steps": 2, "stop_enabled": True, "token_limit": 4}, {"steps": 1, "stop_enabled": False, "token_limit": 1}, {"steps": 2, "stop_enabled": True, "token_limit": 4, "reason": "stop-boundaries"}],
    "residual": [{"weight": .5, "reuse": True}, {"weight": -1, "reuse": True}, {"weight": 0, "reuse": True, "reason": "identity-path"}],
    "normalization": [{"inputs": [1, 2, 3], "amount": 0, "position_enabled": True}, {"inputs": [1, 2, 3], "amount": 2, "position_enabled": True}, {"inputs": [2, 2, 2], "amount": 0, "position_enabled": True, "reason": "feature-axis"}],
    "block": [{"chain": ["norm-attention", "attention", "add-attention"]}, {"chain": ["norm-attention", "attention", "add-attention", "norm-ffn", "ffn", "add-ffn"]}, {"chain": ["norm-attention", "attention", "add-attention", "norm-ffn", "ffn", "add-ffn"], "reason": "pre-norm"}],
    "backprop": [{"weight": 1, "local_slope": -2}, {"weight": 2, "local_slope": 2}, {"weight": 1.5, "local_slope": 0, "reason": "chain-product"}],
    "token": [{"cuts": [2, 3, 5]}, {"cuts": [2, 3, 5], "reason": "same-id"}, {"cuts": [2, 3]}],
    "embedding": [{"rows": [2, 0, 2]}, {"rows": [1, 2]}, {"rows": [2, 0, 2], "reason": "address"}],
    "position": [{"position_enabled": True, "amount": 1}, {"position_enabled": True, "amount": 2}, {"position_enabled": True, "amount": 2, "reason": "order"}],
    "ffn": [{"inputs": [1, 2, 3]}, {"inputs": [1, 0, 3]}, {"inputs": [1, 0, 3], "reason": "pointwise"}],
    "loss": [{"weight": 2}, {"weight": 3, "probes": [1, 3]}, {"weight": 2, "probes": [1, 3], "reason": "squared-mean"}],
    "gradient": [{"weight": 1}, {"weight": 3}, {"weight": 2, "reason": "local-slope"}],
    "descent": [{"rate": .1, "steps": 2}, {"rate": .3, "steps": 2}, {"rate": .1, "steps": 2, "reason": "negative-gradient"}],
    "l2": [{"weight": 1, "lam": 0}, {"weight": .5, "lam": 1}, {"weight": .5, "lam": 1, "reason": "tradeoff"}],
    "temperature": [{"temperature": .5}, {"temperature": 2}, {"temperature": 2, "reason": "distribution"}],
    "entropy": [{"probability": .8}, {"probability": .1}, {"probability": .1, "reason": "target"}],
    "generation": [{"sequence": ["A", "B"]}, {"sequence": ["A", "B", "C", "A"]}, {"sequence": ["A", "B", "C", "A"], "reason": "append-history"}],
    "cache": [{"modes": ["full", "cached"], "reuse": True}, {"modes": ["full", "cached"], "reuse": True}, {"modes": ["full", "cached"], "reuse": True, "reason": "reuse-history"}]
}


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    (root / "data/games/expedition-fixtures.json").write_text(json.dumps(SOLUTIONS, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {sum(len(stages) for stages in SOLUTIONS.values())} explicit practice configurations; these are not independent mastery evidence.")
