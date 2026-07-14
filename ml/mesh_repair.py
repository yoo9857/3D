"""Create a non-destructive normalized mesh derivative.

The source file is never modified.  This is the CPU reference worker; the
licensed 3ds Max worker remains authoritative for rig/material preservation.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
import trimesh


def repair(source: Path, target: Path, voxel_pitch: float | None = None) -> dict:
    scene = trimesh.load(source, force="scene")
    meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    if not meshes: raise ValueError("no mesh geometry")
    mesh = trimesh.util.concatenate(meshes)
    mesh.remove_duplicate_faces() if hasattr(mesh, "remove_duplicate_faces") else mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()
    if hasattr(mesh, "remove_degenerate_faces"): mesh.remove_degenerate_faces()
    else: mesh.update_faces(mesh.nondegenerate_faces())
    trimesh.repair.fix_winding(mesh)
    trimesh.repair.fix_inversion(mesh)
    trimesh.repair.fill_holes(mesh)
    mesh.remove_unreferenced_vertices()
    # Open scans and game assets often contain irreparable seams.  For the
    # geometry-supervision derivative, close those seams with a deterministic
    # voxel remesh; keep the original mesh/UV in the source derivative.
    original_min, original_max = mesh.bounds.copy()
    remeshed = False
    if not mesh.is_watertight:
        pitch = voxel_pitch or float(mesh.extents.max() / 128.0)
        vox = mesh.voxelized(pitch).fill()
        mesh = vox.marching_cubes
        # Preserve the source scene's metric bounds after voxelization.
        new_min, new_max = mesh.bounds.copy()
        mesh.vertices = (mesh.vertices - new_min) / (new_max - new_min + 1e-8)
        mesh.vertices = mesh.vertices * (original_max - original_min) + original_min
        remeshed = True
    target.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(target)
    return {"source": str(source), "target": str(target), "vertices": len(mesh.vertices),
            "faces": len(mesh.faces), "watertight": bool(mesh.is_watertight),
            "winding_consistent": bool(mesh.is_winding_consistent), "voxel_remeshed": remeshed}


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: python ml/mesh_repair.py source.obj normalized.glb [report.json]")
        return 2
    report = repair(Path(sys.argv[1]), Path(sys.argv[2]))
    if len(sys.argv) > 3: Path(sys.argv[3]).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["watertight"] else 1


if __name__ == "__main__": raise SystemExit(main())
