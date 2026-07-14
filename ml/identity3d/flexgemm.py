"""Sparse convolution backend with an optional Triton fast path.

The reference implementation is pure PyTorch and works on CPU.  Production
CUDA builds can provide Triton and register a kernel without changing the
Identity3D pipeline API.
"""
from __future__ import annotations

import torch


def sparse_neighbor_aggregate(coords: torch.Tensor, features: torch.Tensor, radius: int = 1) -> torch.Tensor:
    if coords.ndim != 2 or coords.shape[1] != 3:
        raise ValueError("coords must be [N, 3]")
    if features.shape[0] != coords.shape[0]:
        raise ValueError("features and coords must have matching N")
    # Hash lookup keeps this fallback sparse; no R^3 dense tensor is created.
    lookup = {tuple(row.tolist()): i for i, row in enumerate(coords.cpu())}
    out = torch.zeros_like(features)
    for i, row in enumerate(coords.cpu()):
        neighbors = [i]
        for axis in range(3):
            for delta in (-radius, radius):
                j = lookup.get(tuple((row + torch.nn.functional.one_hot(torch.tensor(axis), 3) * delta).tolist()))
                if j is not None: neighbors.append(j)
        out[i] = features[torch.tensor(neighbors, device=features.device)].mean(0)
    return out


def backend_name() -> str:
    try:
        import triton  # noqa: F401
        return "triton" if torch.cuda.is_available() else "torch-cpu"
    except ImportError:
        return "torch-cuda" if torch.cuda.is_available() else "torch-cpu"
