import math

import pytest

from app.expedition import LabState, mechanics
from app.voyage import adam_trace, filtered, momentum_trace, sampling_trace, stopping_trace
from test_expedition import body, open_for_test
from test_learning_loop import client


def test_minibatch_can_raise_full_objective_while_full_batch_lowers_it():
    whole = mechanics("batch", 0, LabState(rows=[0, 1, 2], steps=1))[0]
    part = mechanics("batch", 1, LabState(rows=[0, 1], steps=1))[0]
    assert whole == pytest.approx([3, -1, .1, 3.5, 3.405])
    assert part == pytest.approx([2, .5, -.05, 3.5, 3.55125])


def test_momentum_reversal_and_adam_bias_correction_have_independent_references():
    weight, velocity, path = momentum_trace(.9, 3)
    assert weight == pytest.approx(-.361) and velocity == pytest.approx(.71)
    assert path[-1][0] == -1 and path[-1][1] > 0
    for i, g in enumerate([2, .2]):
        assert adam_trace(1, True)[i] == pytest.approx(-.1*g/(abs(g)+1e-8))
        assert adam_trace(2, True)[i] == pytest.approx(-.2*g/(abs(g)+1e-8))
    assert adam_trace(1, False)[0] == pytest.approx(-.1 * .2 / (math.sqrt(.004)+1e-8))
    assert adam_trace(3, True)[0] < adam_trace(2, True)[0]


def test_global_clipping_and_cumulative_filter_boundaries():
    clip = mechanics("clipping", 1, LabState(clip_enabled=True, max_norm=1, steps=1))[0]
    assert clip == pytest.approx([5, .2, .6, .8, 1])
    for p, expected in [(.05, 1), (.4, 1), (.4001, 2), (.7, 2), (.7001, 3), (.9, 3), (1., 4)]:
        keep, mass, normalized = filtered("topp", 4, p)
        assert keep == expected and mass >= p - 1e-12 and sum(normalized) == pytest.approx(1.)
    assert filtered("topk", 2, 1)[2] == pytest.approx([4/7, 3/7, 0, 0])


def test_fixed_draw_sets_and_stop_bounds_are_not_randomness_claims():
    assert sampling_trace(10, 0)[1:5] == [4, 3, 2, 1]
    assert sampling_trace(10, 1)[1:5] == [1, 5, 1, 3]
    assert stopping_trace(12, True, 4) == [3, 0, 1, 2, 1, 0, 2]
    assert stopping_trace(12, False, 1) == [2, 0, 1, 0, 1, 1]


def test_stop_cannot_submit_extra_steps_or_invalid_filter_configuration(client):
    open_for_test(client, "stopping")
    request = body("stopping", 0); request["state"]["steps"] = 3
    request["observed"] = mechanics("stopping", 0, LabState(**request["state"]))[0]
    assert client.post("/api/v1/expedition/stopping/moves", json=request).status_code == 422
    for node, patch in [("topk", {"keep_count": 0}), ("topp", {"cutoff": 0}), ("sampling", {"draw_set": 2})]:
        request = body(node, 0); request["state"].update(patch)
        assert client.post(f"/api/v1/expedition/{node}/moves", json=request).status_code == 422
