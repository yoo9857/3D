"""Create an auditable inventory for the Identity3D asset tree.

Usage: python ml/dataset_audit.py training-assets
The report is deterministic and safe to run before every training release.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

IGNORE = {".venv", "__pycache__"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def classify(path: Path) -> str:
    parts = set(path.parts)
    if "00_reference" in parts: return "reference"
    if "01_source_archives" in parts: return "source"
    if "02_max_derivatives" in parts: return "max_derivative"
    if "03_normalized_scene" in parts: return "normalized"
    if "04_supervision" in parts: return "supervision"
    if "05_identity3d_ovoxel" in parts: return "identity3d"
    if "06_qa_reports" in parts: return "qa"
    if "07_release_manifests" in parts: return "release"
    # Existing seed drops predate the folder layout; treat their immutable
    # archives and source meshes as source material until a worker imports them.
    if path.suffix.lower() in {".zip", ".7z", ".max", ".blend", ".obj", ".fbx", ".png", ".jpg", ".jpeg"}:
        return "source"
    return "unclassified"


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "training-assets").resolve()
    files = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == ".gitkeep" or any(part in IGNORE for part in path.parts): continue
        files.append({"path": str(path.relative_to(root)).replace("\\", "/"), "kind": classify(path),
                      "bytes": path.stat().st_size, "sha256": sha256(path)})
    by_hash = {}
    for item in files: by_hash.setdefault(item["sha256"], []).append(item["path"])
    report = {"root": str(root), "file_count": len(files), "files": files,
              "duplicates": [paths for paths in by_hash.values() if len(paths) > 1]}
    out = root / "07_release_manifests" / "asset-inventory.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Indexed {len(files)} files; duplicate groups: {len(report['duplicates'])}; wrote {out}")


if __name__ == "__main__":
    main()
