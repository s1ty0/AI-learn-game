from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Position(BaseModel):
    x: float = Field(allow_inf_nan=False, ge=-100000, le=100000)
    y: float = Field(allow_inf_nan=False, ge=-100000, le=100000)


class NodeData(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    subtitle: str = Field(default="我的理解", max_length=100)
    category: str = Field(default="custom", max_length=30)
    note: str = Field(default="", max_length=3000)


class GraphNode(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    type: Literal["knowledge"] = "knowledge"
    position: Position
    data: NodeData


class GraphEdge(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    source: str
    target: str
    label: str = Field(default="待解释的关系", max_length=200)


class GraphPayload(BaseModel):
    nodes: list[GraphNode] = Field(min_length=1, max_length=150)
    edges: list[GraphEdge] = Field(max_length=500)

    @model_validator(mode="after")
    def references(self):
        node_ids = {n.id for n in self.nodes}
        if len(node_ids) != len(self.nodes) or len({e.id for e in self.edges}) != len(self.edges):
            raise ValueError("Duplicate node or edge identity")
        if any(e.source not in node_ids or e.target not in node_ids for e in self.edges):
            raise ValueError("Unknown edge endpoint")
        return self


class GraphMutation(BaseModel):
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8, max_length=120)
    payload: GraphPayload
    note: str = Field(default="更新我的理解", min_length=1, max_length=200)


class RestoreMutation(BaseModel):
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8, max_length=120)
    revision: int = Field(ge=0)


class AttemptSubmission(BaseModel):
    operation_key: str = Field(min_length=8, max_length=120)
    task_id: Literal["TF-Q04"] = "TF-Q04"
    prediction: Literal["same", "different"]
    explanation: str = Field(min_length=5, max_length=3000)
    hint_used: bool = False
    mask_enabled: bool
    future_value: float = Field(ge=0, le=40, allow_inf_nan=False)
    observed: list[float] = Field(min_length=3, max_length=3)


class AdventureMove(BaseModel):
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8, max_length=120)
    stage: int = Field(ge=0, le=2)
    mask_enabled: bool
    future_value: float = Field(ge=0, le=40, allow_inf_nan=False)
    reason: Literal["blocked", "distance", "weak"] | None = None
    hint_used: bool = False


class PrismMove(BaseModel):
    base_revision: int = Field(ge=0)
    operation_key: str = Field(min_length=8, max_length=120)
    stage: int = Field(ge=0, le=2)
    scores: list[float] = Field(min_length=3, max_length=3)
    weights: list[float] = Field(min_length=3, max_length=3)
    output: float = Field(allow_inf_nan=False)
    reason: Literal["relative", "raw", "winner"] | None = None
    hint_used: bool = False

    @model_validator(mode="after")
    def finite_scores(self):
        import math
        if any(not math.isfinite(value) or not 0 <= value <= 4 for value in self.scores):
            raise ValueError("Preference scores must be finite in [0,4]")
        if any(not math.isfinite(value) or not 0 <= value <= 1 for value in self.weights):
            raise ValueError("Weights must be finite in [0,1]")
        return self
