"""Inspectable one-block causal decoder: synthetic data, CPU, no downloads.

Teaching variant: learned embeddings + sinusoidal positions + Pre-Norm + ReLU FFN.
This is not a reproduction of the original encoder-decoder or a pretrained LLM.
Run: python examples/tiny_transformer.py
"""

import json
import math

import torch
from torch import nn
from torch.nn import functional as F


def shifted_batch(sequences):
    if sequences.ndim != 2 or sequences.shape[1] < 2:
        raise ValueError("Expected batch x sequence with at least two tokens")
    return sequences[:, :-1], sequences[:, 1:]


def sinusoidal_positions(length, width):
    if length < 1 or width < 2 or width % 2:
        raise ValueError("Use positive length and even width")
    positions = torch.arange(length, dtype=torch.float32).unsqueeze(1)
    frequencies = torch.exp(torch.arange(0, width, 2, dtype=torch.float32) * (-math.log(10000) / width))
    table = torch.zeros(length, width)
    table[:, 0::2] = torch.sin(positions * frequencies)
    table[:, 1::2] = torch.cos(positions * frequencies)
    return table


class TinyDecoder(nn.Module):
    def __init__(self, vocabulary=7, width=8, heads=2, hidden=16, max_length=12):
        super().__init__()
        if vocabulary < 2 or heads < 1 or width % heads or width % 2 or hidden < 1:
            raise ValueError("Invalid toy model dimensions")
        self.vocabulary, self.width, self.heads = vocabulary, width, heads
        self.max_length = max_length
        self.embedding = nn.Embedding(vocabulary, width)
        self.register_buffer("positions", sinusoidal_positions(max_length, width))
        self.norm_attention = nn.LayerNorm(width)
        self.qkv = nn.Linear(width, 3 * width, bias=False)
        self.attention_out = nn.Linear(width, width, bias=False)
        self.norm_ffn = nn.LayerNorm(width)
        self.ffn = nn.Sequential(nn.Linear(width, hidden), nn.ReLU(), nn.Linear(hidden, width))
        self.norm_final = nn.LayerNorm(width)
        self.output = nn.Linear(width, vocabulary, bias=False)

    def forward(self, token_ids, padding=None):
        if token_ids.ndim != 2 or token_ids.shape[1] < 1:
            raise ValueError("Expected a nonempty batch x sequence")
        batch, length = token_ids.shape
        if length > self.max_length:
            raise ValueError("Sequence exceeds this teaching model's position table")
        if padding is not None and (padding.shape != token_ids.shape or padding.dtype != torch.bool):
            raise ValueError("Padding must be a matching boolean matrix; True means padding")
        x = self.embedding(token_ids) + self.positions[:length]
        q, k, v = self.qkv(self.norm_attention(x)).chunk(3, dim=-1)
        head_width = self.width // self.heads

        def split_heads(tensor):
            return tensor.reshape(batch, length, self.heads, head_width).transpose(1, 2)

        q, k, v = map(split_heads, (q, k, v))
        scores = q @ k.transpose(-2, -1) / math.sqrt(head_width)
        allowed = torch.ones(length, length, dtype=torch.bool, device=x.device).tril()
        allowed = allowed[None, None, :, :].expand(batch, 1, length, length)
        if padding is not None:
            allowed = allowed & ~padding[:, None, None, :]
        if not allowed.any(dim=-1).all():
            raise ValueError("At least one query has every key masked; use nonempty right-padded sequences")
        weights = scores.masked_fill(~allowed, float("-inf")).softmax(dim=-1)
        context = (weights @ v).transpose(1, 2).contiguous().reshape(batch, length, self.width)
        x = x + self.attention_out(context)
        x = x + self.ffn(self.norm_ffn(x))
        logits = self.output(self.norm_final(x))
        shapes = {"input_ids": list(token_ids.shape), "hidden": list(x.shape),
                  "q_per_head": list(q.shape), "weights": list(weights.shape), "logits": list(logits.shape)}
        return logits, weights, shapes


def language_loss(logits, labels, ignore_index=-100):
    if labels.shape != logits.shape[:-1]:
        raise ValueError("Labels must match batch and sequence axes")
    if not (labels != ignore_index).any():
        raise ValueError("At least one supervised position is required")
    return F.cross_entropy(logits.reshape(-1, logits.shape[-1]), labels.reshape(-1), ignore_index=ignore_index)


def demo(steps=100):
    torch.manual_seed(7)
    torch.set_num_threads(1)
    model = TinyDecoder()
    # IDs 1..6 are abstract symbols, NOT the output of a natural-language tokenizer.
    full = torch.tensor([[1, 2, 3, 4, 5, 6], [2, 3, 4, 5, 6, 1],
                         [3, 4, 5, 6, 1, 2], [4, 5, 6, 1, 2, 3]])
    inputs, labels = shifted_batch(full)
    optimizer = torch.optim.SGD(model.parameters(), lr=0.15)
    before = float(language_loss(model(inputs)[0], labels).detach())
    for _ in range(steps):
        optimizer.zero_grad(set_to_none=True)
        loss = language_loss(model(inputs)[0], labels)
        loss.backward()
        optimizer.step()
    model.eval()
    with torch.no_grad():
        logits, weights, shapes = model(inputs)
        after = float(language_loss(logits, labels))
        generated = torch.tensor([[1, 2]])
        for _ in range(3):
            next_logits = model(generated)[0][:, -1, :]
            generated = torch.cat((generated, next_logits.argmax(-1, keepdim=True)), dim=1)
    return {"torch_version": torch.__version__, "device": "cpu", "seed": 7, "steps": steps,
            "model_parameters": sum(p.numel() for p in model.parameters()), "shapes": shapes,
            "training_loss_before": before, "training_loss_after": after,
            "first_prediction_ids": logits[0].argmax(-1).tolist(), "first_label_ids": labels[0].tolist(),
            "generated_ids_from_1_2": generated[0].tolist(),
            "first_query_attention": weights[0, 0, 0].tolist(),
            "scope": "Training-data fit only: no validation/test score, natural language or capability claim."}


if __name__ == "__main__":
    print(json.dumps(demo(), ensure_ascii=False, indent=2, allow_nan=False))
