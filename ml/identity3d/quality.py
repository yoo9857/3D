"""Production quality contract for Identity3D character outputs."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import numpy as np
import trimesh


@dataclass(frozen=True)
class QualityThresholds:
    max_degenerate_faces: int = 0
    min_height_ratio: float = 1.15
    min_uv_coverage: float = 0.35
    require_texture: bool = True


def evaluate_character(mesh: trimesh.Trimesh, thresholds: QualityThresholds = QualityThresholds()) -> dict:
    ext = np.asarray(mesh.extents, dtype=float)
    uv = getattr(getattr(mesh, "visual", None), "uv", None)
    material = getattr(getattr(mesh, "visual", None), "material", None)
    texture = bool(material is not None and (
        getattr(material, "baseColorTexture", None) is not None
        or getattr(material, "image", None) is not None
    ))
    uv_coverage = float(np.clip(
        np.ptp(uv[:, 0]) * np.ptp(uv[:, 1]) if uv is not None and len(uv) else 0.0, 0.0, 1.0
    ))
    degenerate = int(np.count_nonzero(mesh.area_faces <= 1e-10))
    finite = bool(np.isfinite(mesh.vertices).all())
    upright_ratio = float(ext[1] / max(ext[0], ext[2], 1e-8))
    checks = {
        "finite_vertices": finite,
        "has_faces": bool(len(mesh.faces) > 0),
        "winding_consistent": bool(mesh.is_winding_consistent),
        "degenerate_faces": degenerate <= thresholds.max_degenerate_faces,
        "upright_y": upright_ratio >= thresholds.min_height_ratio,
        "uv_coverage": uv_coverage >= thresholds.min_uv_coverage,
        "texture_present": texture or not thresholds.require_texture,
    }
    retry_reasons = [name for name, passed in checks.items() if not passed]
    return {
        "schema": "identity3d.quality.v1",
        "pass": not retry_reasons,
        "score": float(sum(checks.values()) / len(checks)),
        "checks": checks,
        "metrics": {
            "vertices": int(len(mesh.vertices)), "faces": int(len(mesh.faces)),
            "bounds_xyz": ext.tolist(), "upright_ratio": upright_ratio,
            "uv_coverage": uv_coverage, "degenerate_faces": degenerate,
            "watertight": bool(mesh.is_watertight),
        },
        "retry_reasons": retry_reasons,
        "thresholds": asdict(thresholds),
    }
