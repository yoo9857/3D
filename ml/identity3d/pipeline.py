"""Own Identity3D reconstruction contract.

This is intentionally model-agnostic: a future identity encoder can emit
O-Voxels directly, while the current local image encoder can use the existing
depth/segmentation worker and then pass through the same post-processing.
"""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np

from .ovoxel import OVoxel, OVoxelConfig
from .cumesh import process_mesh


@dataclass(frozen=True)
class IdentityPipelineConfig:
    voxel_resolution: int = 128
    target_faces: int = 100_000


class IdentityPipeline:
    def __init__(self, config: IdentityPipelineConfig = IdentityPipelineConfig()):
        self.config = config

    def mesh_to_ovoxel(self, vertices: np.ndarray, faces: np.ndarray,
                          colors: np.ndarray | None = None) -> OVoxel:
        return OVoxel.from_mesh(vertices, faces, colors, OVoxelConfig(self.config.voxel_resolution))

    def ovoxel_to_mesh(self, representation: OVoxel) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        vertices, faces, colors = representation.to_mesh()
        return process_mesh(vertices, faces, colors, self.config.target_faces)

    def round_trip(self, vertices: np.ndarray, faces: np.ndarray,
                   colors: np.ndarray | None = None) -> tuple[OVoxel, tuple[np.ndarray, np.ndarray, np.ndarray]]:
        ov = self.mesh_to_ovoxel(vertices, faces, colors)
        return ov, self.ovoxel_to_mesh(ov)
