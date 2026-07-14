"""High precision mesh gate for normalized Identity3D assets."""
from __future__ import annotations

import json
import sys
from pathlib import Path
import numpy as np
import trimesh


def inspect(path: Path) -> dict:
    scene = trimesh.load(path, force="scene")
    meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    if not meshes:
        raise ValueError("no mesh geometry")
    mesh = trimesh.util.concatenate(meshes)
    uv = getattr(getattr(mesh, "visual", None), "uv", None)
    edge_counts = np.bincount(mesh.edges_unique_inverse, minlength=len(mesh.edges_unique))
    ext = mesh.bounds[1] - mesh.bounds[0]
    report = {
        "path": str(path), "vertices": int(len(mesh.vertices)), "faces": int(len(mesh.faces)),
        "watertight": bool(mesh.is_watertight), "winding_consistent": bool(mesh.is_winding_consistent),
        "non_manifold_edges": int(np.count_nonzero(edge_counts != 2)),
        "degenerate_faces": int(np.count_nonzero(mesh.area_faces <= 1e-10)),
        "bounds": ext.astype(float).tolist(), "finite_vertices": bool(np.isfinite(mesh.vertices).all()),
        "uv_coverage": float(np.clip((np.ptp(uv[:, 0]) * np.ptp(uv[:, 1])) if uv is not None and len(uv) else 0.0, 0, 1)),
        "texture_present": bool(getattr(getattr(mesh, "visual", None), "material", None)),
    }
    report["warnings"] = []
    if not report["texture_present"]: report["warnings"].append("texture_reprojection_required")
    report["pass"] = bool(report["finite_vertices"] and report["faces"] > 0 and report["degenerate_faces"] == 0 and report["watertight"])
    return report


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python ml/mesh_qa.py normalized_mesh [report.json]")
        return 2
    report = inspect(Path(sys.argv[1]))
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
