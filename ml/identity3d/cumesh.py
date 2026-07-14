"""Mesh post-processing boundary for Identity3D.

CUDA/CuMesh can be plugged in behind these functions.  The portable fallback
uses trimesh and preserves the exact same call contract.
"""
from __future__ import annotations

import numpy as np


def process_mesh(vertices: np.ndarray, faces: np.ndarray, colors: np.ndarray | None = None,
                 target_faces: int = 100_000) -> tuple[np.ndarray, np.ndarray, np.ndarray | None]:
    import trimesh
    mesh = trimesh.Trimesh(vertices=np.asarray(vertices), faces=np.asarray(faces), process=False)
    # O-Voxel's portable cube emitter duplicates face corners intentionally;
    # weld them before topology/decimation checks so the result is a connected
    # manifold mesh rather than a collection of coincident triangles.
    mesh.merge_vertices(digits_vertex=8)
    # trimesh renamed these mutating helpers; support both current and older
    # releases so the reference path remains reproducible.
    if hasattr(mesh, "remove_duplicate_faces"):
        mesh.remove_duplicate_faces()
        mesh.remove_degenerate_faces()
    else:
        mesh.update_faces(mesh.unique_faces())
        mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    if target_faces > 0 and len(mesh.faces) > target_faces:
        try:
            mesh = mesh.simplify_quadric_decimation(target_faces)
        except (ImportError, ModuleNotFoundError):
            # Keep the high-resolution reference when optional fast
            # simplification is not installed; never fail the identity path.
            pass
    out_colors = colors
    if out_colors is not None and len(out_colors) != len(mesh.vertices):
        out_colors = None
    return np.asarray(mesh.vertices, np.float32), np.asarray(mesh.faces, np.int32), out_colors


def backend_name() -> str:
    try:
        import cumesh  # type: ignore  # noqa: F401
        return "cumesh-cuda"
    except ImportError:
        return "trimesh-cpu"
