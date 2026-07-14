"""Transfer source appearance to a repaired mesh and generate deterministic UVs."""
from __future__ import annotations

import json
import sys
from pathlib import Path
import numpy as np
import trimesh
from PIL import Image


def reproject(source: Path, repaired: Path, texture: Path, output: Path) -> dict:
    src_scene = trimesh.load(source, force="scene")
    src_meshes = [g for g in src_scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    if not src_meshes: raise ValueError("source has no mesh")
    src = trimesh.util.concatenate(src_meshes)
    dst = trimesh.load(repaired, force="mesh")
    # Use scipy when available; nearest-vertex transfer is deterministic and
    # remains usable on machines without an acceleration package.
    try:
        from scipy.spatial import cKDTree
        nearest = cKDTree(src.vertices).query(dst.vertices, workers=-1)[1]
    except Exception:
        nearest = np.asarray([np.argmin(np.sum((src.vertices - p) ** 2, axis=1)) for p in dst.vertices])
    src_colors = getattr(getattr(src, "visual", None), "vertex_colors", None)
    colors = np.asarray(src_colors[nearest, :4] if src_colors is not None else np.full((len(dst.vertices), 4), 255), dtype=np.uint8)
    # Cylindrical UVs are stable for characters and avoid invalid coordinates.
    lo, hi = dst.bounds
    angle = (np.arctan2(dst.vertices[:, 0], dst.vertices[:, 2]) / (2 * np.pi) + 0.5) % 1.0
    vertical = np.clip((dst.vertices[:, 1] - lo[1]) / max(1e-8, hi[1] - lo[1]), 0, 1)
    uv = np.column_stack((angle, vertical)).astype(np.float32)
    image = Image.open(texture).convert("RGBA")
    visual = trimesh.visual.texture.TextureVisuals(uv=uv, image=image)
    visual.vertex_colors = colors
    dst.visual = visual
    output.parent.mkdir(parents=True, exist_ok=True)
    dst.export(output)
    return {"source": str(source), "repaired": str(repaired), "output": str(output),
            "vertices": len(dst.vertices), "uv_coverage": float(np.ptp(uv[:, 0]) * np.ptp(uv[:, 1])),
            "texture": str(texture)}


def main() -> int:
    if len(sys.argv) < 5:
        print("usage: python ml/texture_reproject.py source.obj repaired.glb texture.png output.glb")
        return 2
    report = reproject(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__": raise SystemExit(main())
