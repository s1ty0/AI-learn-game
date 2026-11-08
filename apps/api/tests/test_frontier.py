import math

import pytest

from app.expedition import LabState, mechanics
from app.frontier import gqa_values, norm_values, rope_values, schedule_rate, split_values
from test_expedition import body, open_for_test
from test_learning_loop import client


def test_rms_and_rope_match_independent_formula_and_geometric_invariants():
    value = norm_values(1, 0, "rms")
    assert value[2:4] == pytest.approx([1/math.sqrt(2.5+1e-5), 2/math.sqrt(2.5+1e-5)])
    assert sum(value[2:4])/2 > .9
    assert norm_values(1, 2, "rms")[4:6] == pytest.approx(value[4:6])
    for position in range(5):
        rotated = rope_values(position, position+1, True)
        assert math.hypot(*rotated[:2]) == pytest.approx(1)
        assert math.hypot(*rotated[2:4]) == pytest.approx(1)
        assert rotated[4] == pytest.approx(math.sqrt(.5))


def test_gqa_counts_outputs_and_swiglu_sign_have_independent_reference():
    full, grouped, shared = gqa_values(4), gqa_values(2), gqa_values(1)
    assert [full[2], grouped[2], shared[2]] == [16, 8, 4]
    assert grouped[3:7] == [0, 0, 1, 1] and shared[:2] == [4, 1]
    assert full[7] == pytest.approx(2+4/(1+math.e))
    assert grouped[8] != pytest.approx(full[8])
    assert mechanics("swiglu", 1, LabState(gate_input=-2, branch_input=2))[0][-1] == pytest.approx(-4/(1+math.exp(2)))


def test_evaluation_isolation_curve_and_schedule_boundaries():
    assert split_values([0,1,0,2,1,2])[:4] == [2,2,2,3]
    clean = mechanics("leakage", 1, LabState(fit_scope="train", held_out=200))[0]
    leaky = mechanics("leakage", 1, LabState(fit_scope="all", held_out=200))[0]
    assert clean == [0,2,0,1,100] and leaky == [0,200,0,.01,1]
    for c in [0,.5,1,1.5,2]:
        metrics = mechanics("overfit", 0, LabState(curvature=c))[0]
        assert metrics[0] == 0 and metrics[1] == pytest.approx(.78125*c*c)
    assert [schedule_rate(i) for i in range(7)] == pytest.approx([0,.05,.1,.075,.05,.025,0])


def test_schema_and_rules_reject_invalid_grouping_or_scope(client):
    open_for_test(client, "split")
    request = body("split", 0)
    assert client.post("/api/v1/expedition/split/moves", json=request).status_code == 200
    request = body("split", 1); request["state"]["partitions"] = [0,1,0,2,1,2]
    request["observed"] = split_values(request["state"]["partitions"])
    assert client.post("/api/v1/expedition/split/moves", json=request).status_code == 422
    for node, patch in [("gqa", {"kv_heads":3}), ("rope", {"query_position":7}), ("leakage", {"fit_scope":"remote"}), ("split", {"partitions":[0,1,2]})]:
        request = body(node, 0); request["state"].update(patch)
        assert client.post(f"/api/v1/expedition/{node}/moves", json=request).status_code == 422
