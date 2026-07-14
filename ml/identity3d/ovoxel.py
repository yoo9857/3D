"""Sparse O-Voxel representation used by the Identity3D pipeline.

An O-Voxel is a compact list of occupied voxel coordinates and per-voxel
features (RGB, normal and learned channels).  Keeping coordinates sparse is
important for characters: background voxels otherwise dominate memory and
make training wasteful.
"""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class OVoxelConfig:
    resolution: int = 128
    channels: int = 6  # rgb + normal; learned channels may be appended


@dataclass
class OVoxel:
    coords: np.ndarray       # (N, 3), int32, x/y/z order
    features: np.ndarray     # (N, C), float32 in [0, 1] where applicable
    resolution: int

    def __post_init__(self) -> None:
        self.coords = np.asarray(self.coords, dtype=np.int32)
        self.features = np.asarray(self.features, dtype=np.float32)
        if self.coords.ndim != 2 or self.coords.shape[1] != 3:
            raise ValueError("coords must have shape (N, 3)")
        if self.features.ndim != 2 or self.features.shape[0] != self.coords.shape[0]:
            raise ValueError("features must have shape (N, C) matching coords")
        if np.any(self.coords < 0) or np.any(self.coords >= self.resolution):
            raise ValueError("voxel coordinates outside resolution")

    @property
    def channels(self) -> int:
        return int(self.features.shape[1])

    def dense(self, fill: float = 0.0) -> np.ndarray:
        out = np.full((self.resolution, self.resolution, self.resolution, self.channels), fill, np.float32)
        if len(self.coords):
            x, y, z = self.coords.T
            out[x, y, z] = self.features
        return out

    @classmethod
    def from_dense(cls, values: np.ndarray, threshold: float = 0.01) -> "OVoxel":
        values = np.asarray(values, dtype=np.float32)
        if values.ndim != 4 or not values.shape[0] == values.shape[1] == values.shape[2]:
            raise ValueError("dense values must have shape (R, R, R, C)")
        occupied = np.max(np.abs(values), axis=-1) > threshold
        coords = np.argwhere(occupied).astype(np.int32)
        features = values[occupied].astype(np.float32, copy=False)
        return cls(coords, features, values.shape[0])

    @classmethod
    def from_mesh(cls, vertices: np.ndarray, faces: np.ndarray, colors: np.ndarray | None = None,
                  config: OVoxelConfig = OVoxelConfig()) -> "OVoxel":
        """Rasterize a mesh into sparse surface voxels (CPU reference path).

        This deliberately conservative sampler is deterministic and forms the
        correctness reference for the future CUDA voxelizer.
        """
        vertices = np.asarray(vertices, dtype=np.float32)
        faces = np.asarray(faces, dtype=np.int32)
        if vertices.ndim != 2 or vertices.shape[1] != 3 or faces.ndim != 2 or faces.shape[1] != 3:
            raise ValueError("vertices/faces have invalid shape")
        lo, hi = vertices.min(0), vertices.max(0)
        span = np.maximum(hi - lo, 1e-6)
        p = np.clip((vertices - lo) / span * (config.resolution - 1), 0, config.resolution - 1)
        cells: dict[tuple[int, int, int], np.ndarray] = {}
        color_values = np.asarray(colors, dtype=np.float32) if colors is not None else None
        for face_index, tri in enumerate(p[faces]):
            # Subdivide triangle edges; the CUDA implementation can replace
            # this with a watertight triangle-box test without changing output.
            length = max(2, int(np.max(np.ptp(tri, axis=0))) + 1)
            for a in np.linspace(0, 1, length):
                for b in np.linspace(0, 1 - a, max(2, length // 2)):
                    q = tri[0] * (1 - a - b) + tri[1] * a + tri[2] * b
                    key = tuple(np.rint(q).astype(np.int32))
                    if color_values is not None:
                        c = color_values[faces[face_index]].mean(0)
                    else:
                        c = np.ones(3, np.float32)
                    cells[key] = np.r_[c[:3], 0.0, 0.0, 1.0]
        if not cells:
            return cls(np.empty((0, 3), np.int32), np.empty((0, config.channels), np.float32), config.resolution)
        coords = np.array(list(cells), np.int32)
        features = np.array(list(cells.values()), np.float32)
        return cls(coords, features[:, :config.channels], config.resolution)

    def to_mesh(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Return a watertight cube-surface mesh (portable reference path)."""
        # Prefer trimesh's marching-cubes implementation when available. It
        # welds shared edges and produces a manifold surface; the explicit
        # cube emitter below remains the dependency-free fallback.
        try:
            import trimesh
            occupancy = np.zeros((self.resolution, self.resolution, self.resolution), dtype=bool)
            if len(self.coords):
                x, y, z = self.coords.T
                occupancy[x, y, z] = True
            marching = trimesh.voxel.ops.matrix_to_marching_cubes(occupancy)
            v = np.asarray(marching.vertices, np.float32) / max(1, self.resolution - 1) - 0.5
            f = np.asarray(marching.faces, np.int32)
            c = np.ones((len(v), 3), np.float32)
            return v, f, c
        except ImportError:
            pass
        occupied = {tuple(c) for c in self.coords.tolist()}
        feature_map = {tuple(c): self.features[i, :3] for i, c in enumerate(self.coords)}
        verts: list[tuple[float, float, float]] = []
        faces: list[tuple[int, int, int]] = []
        face_defs = (((1, 0, 0), (1, 2, 6, 5)), ((-1, 0, 0), (0, 4, 7, 3)),
                     ((0, 1, 0), (3, 7, 6, 2)), ((0, -1, 0), (0, 1, 5, 4)),
                     ((0, 0, 1), (4, 5, 6, 7)), ((0, 0, -1), (0, 3, 2, 1)))
        vertex_colors: list[tuple[float, float, float]] = []
        for x, y, z in occupied:
            for side, (delta, quad) in enumerate(face_defs):
                if (x + delta[0], y + delta[1], z + delta[2]) in occupied:
                    continue
                base = len(verts)
                corners = ((x, y, z), (x + 1, y, z), (x + 1, y + 1, z), (x, y + 1, z),
                           (x, y, z + 1), (x + 1, y, z + 1), (x + 1, y + 1, z + 1), (x, y + 1, z + 1))
                verts.extend(corners)
                color = tuple(feature_map.get((x, y, z), np.ones(3, np.float32)))
                vertex_colors.extend([color] * 8)
                a, b, c, d = (base + i for i in quad)
                faces.extend(((a, b, c), (a, c, d)))
        v = np.asarray(verts, np.float32) / max(1, self.resolution - 1) - 0.5
        f = np.asarray(faces, np.int32).reshape(-1, 3)
        c = np.asarray(vertex_colors, np.float32).reshape(-1, 3)
        return v, f, c
