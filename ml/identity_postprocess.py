"""Apply the local Identity3D O-Voxel round-trip to an existing GLB."""
from __future__ import annotations

import sys
import json
from pathlib import Path
import trimesh
import numpy as np
from PIL import Image
from identity3d import IdentityPipeline, IdentityPipelineConfig, evaluate_character


def apply_image_texture(mesh: trimesh.Trimesh, texture_path: str) -> None:
    image = Image.open(texture_path).convert("RGBA")
    # Derive a tangent-space normal map from image luminance so cloth/armor
    # detail survives even when the source has no authored normal texture.
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    gy, gx = np.gradient(lum)
    # The source image is a color/albedo reference, not a height map.  A
    # strong image-derived normal turns painted edges into ripple-like bumps
    # (the "wavy" color artifact seen in single-view output).  Keep this as a
    # restrained micro-detail cue; authored normals can replace it later.
    strength = 0.08
    nx, ny = -gx * strength, -gy * strength
    nz = np.ones_like(lum)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack((nx / norm, ny / norm, nz / norm), axis=-1)
    normal_img = Image.fromarray(np.uint8(np.clip(normal * 127.5 + 127.5, 0, 255)), "RGB")
    lo, hi = mesh.bounds
    horizontal = np.clip((mesh.vertices[:, 0] - lo[0]) / max(1e-8, hi[0] - lo[0]), 0, 1)
    vertical = 1.0 - np.clip((mesh.vertices[:, 1] - lo[1]) / max(1e-8, hi[1] - lo[1]), 0, 1)
    uv = np.column_stack((horizontal, vertical)).astype(np.float32)
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=image,
        normalTexture=normal_img,
        roughnessFactor=0.78,
        metallicFactor=0.02,
    )
    mesh.visual = trimesh.visual.texture.TextureVisuals(uv=uv, material=material)


def main() -> None:
    source, target = sys.argv[1], sys.argv[2]
    texture_path = sys.argv[3] if len(sys.argv) > 3 and Path(sys.argv[3]).exists() else None
    report_path = Path(sys.argv[4]) if len(sys.argv) > 4 else Path(target).with_suffix(".quality.json")
    scene = trimesh.load(source, force="scene")
    meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    if not meshes:
        raise RuntimeError("GLB has no mesh geometry")
    mesh = trimesh.util.concatenate(meshes)
    # Remove floating scan fragments while retaining meaningful accessories.
    # Tiny disconnected islands are the main cause of cut-off limbs and dark
    # specks in a single-image reconstruction.
    components = mesh.split(only_watertight=False)
    if len(components) > 1:
        components.sort(key=lambda part: float(part.area), reverse=True)
        main_area = max(float(components[0].area), 1e-8)
        kept = [part for part in components if float(part.area) >= main_area * 0.008]
        mesh = trimesh.util.concatenate(kept)
    mesh.remove_unreferenced_vertices()
    trimesh.repair.fix_winding(mesh)
    trimesh.repair.fix_inversion(mesh)
    # Character reconstruction models may emit a Z-up/sideways body.  Keep
    # generic props untouched, but rotate strongly horizontal character-like
    # bounds into the app's Y-up convention.
    # Canonical character frame: PCA removes roll/lean before the viewer sees
    # the model. Largest principal axis = height (Y), second = shoulders (X),
    # third = front/back (Z). This is deterministic for a single-view result.
    center = mesh.centroid
    centered = mesh.vertices - center
    covariance = np.cov(centered.T) if len(centered) > 3 else np.eye(3)
    values, vectors = np.linalg.eigh(covariance)
    order = np.argsort(values)[::-1]
    up = vectors[:, order[0]]
    side = vectors[:, order[1]]
    # PCA eigenvectors have arbitrary signs.  The character convention is
    # Y-up, therefore only invert when the principal height axis points down.
    # The previous `> 0` condition inverted already-correct models and caused
    # upside-down results.
    if np.dot(up, np.array([0.0, 1.0, 0.0])) < 0: up = -up
    if np.dot(side, np.array([1.0, 0.0, 0.0])) < 0: side = -side
    depth = np.cross(side, up)
    if np.dot(depth, np.array([0.0, 0.0, 1.0])) < 0: depth = -depth
    # Re-orthogonalize side after the sign choices.
    side = np.cross(up, depth)
    mesh.vertices = np.column_stack((centered @ side, centered @ up, centered @ depth))
    colors = None
    if hasattr(mesh.visual, "vertex_colors") and len(mesh.visual.vertex_colors) == len(mesh.vertices):
        colors = mesh.visual.vertex_colors[:, :3].astype("float32") / 255.0
    pipeline = IdentityPipeline(IdentityPipelineConfig(voxel_resolution=128, target_faces=100_000))
    ov, (vertices, faces, out_colors) = pipeline.round_trip(mesh.vertices, mesh.faces, colors)
    candidate = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    # A surface-only voxel round-trip is a training representation, not an
    # unconditional display replacement.  Reject topology explosions and
    # preserve the source GLB for visual fidelity when the candidate is worse.
    inflation = len(candidate.faces) / max(1, len(mesh.faces))
    candidate_ok = bool(candidate.is_watertight and candidate.is_winding_consistent and inflation <= 1.8)
    if candidate_ok:
        result = candidate
        if out_colors is not None:
            result.visual.vertex_colors = (out_colors.clip(0, 1) * 255).astype("uint8")
    else:
        result = mesh
        # Broken/quantized source vertex colors are worse than a neutral
        # material. The browser's physically based lighting then remains
        # stable while a future texture reprojection can replace it.
        result.visual.vertex_colors = np.full((len(result.vertices), 4), 255, dtype=np.uint8)
    if hasattr(result, "remove_duplicate_faces"):
        result.remove_duplicate_faces()
        result.remove_degenerate_faces()
    else:
        result.update_faces(result.unique_faces())
        result.update_faces(result.nondegenerate_faces())
    result.remove_unreferenced_vertices()
    if texture_path:
        apply_image_texture(result, texture_path)
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    result.export(target)
    quality = evaluate_character(result)
    quality.update({
        "candidate_accepted": candidate_ok,
        "ovoxel_inflation": float(inflation),
        "coordinate_system": "right-handed-y-up-front-positive-z",
    })
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8")
    # Keep the learned sparse representation alongside the display mesh.
    sidecar = Path(target).with_suffix(".ovoxel.npz")
    np.savez_compressed(sidecar, coords=ov.coords, features=ov.features, resolution=ov.resolution,
                        candidate_accepted=np.array([candidate_ok]), inflation=np.array([inflation]))


if __name__ == "__main__":
    main()
