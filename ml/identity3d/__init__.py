"""Identity3D core data structures.

The package intentionally has no hosted-model dependency.  Encoders and
decoders can be replaced independently while the O-Voxel contract remains
stable between training, reconstruction and export.
"""

from .ovoxel import OVoxel, OVoxelConfig
from .pipeline import IdentityPipeline, IdentityPipelineConfig
from .quality import QualityThresholds, evaluate_character

__all__ = [
    "OVoxel", "OVoxelConfig", "IdentityPipeline", "IdentityPipelineConfig",
    "QualityThresholds", "evaluate_character",
]
