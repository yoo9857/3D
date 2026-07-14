"""Build identity-safe human training records from an asset inventory.

The script creates deterministic view plans and train/val/test splits. It does
not copy or publish human data; operators still attach consent/license IDs.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


def split(identity: str) -> str:
    bucket = int(hashlib.sha256(identity.encode()).hexdigest()[:8], 16) % 100
    return "test" if bucket < 10 else "val" if bucket < 20 else "train"


def views() -> list[dict]:
    out = []
    for i, azimuth in enumerate((0, 45, 90, 135, 180, 225, 270, 315)):
        for elevation in (-15, 0, 15):
            out.append({"view_id": f"{i:02d}_{elevation:+03d}", "azimuth": azimuth,
                        "elevation": elevation, "focal_mm": 35 if elevation else 50})
    return out


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "training-assets")
    output = Path(sys.argv[2] if len(sys.argv) > 2 else root / "07_release_manifests/human.generated.jsonl")
    identities = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".obj", ".fbx", ".blend", ".max", ".glb"}:
            continue
        rel_parts = set(path.relative_to(root).parts)
        if rel_parts & {"03_normalized_scene", "04_supervision", "05_identity3d_ovoxel", "06_qa_reports", "07_release_manifests"}:
            continue
        name = path.stem.lower()
        if any(token in name for token in ("male", "female", "human", "character", "rpg")):
            identities.append((path.stem, str(path.relative_to(root)).replace("\\", "/")))
    identities = list(dict((item[0], item) for item in identities).values())
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as f:
        for identity, source in identities:
            record = {"sample_id": identity, "identity_id": identity,
                      "split": split(identity), "source_tier": "review_required",
                      "source": source, "consent_id": None, "license_id": None,
                      "camera_plan": views(), "required_passes": ["rgb", "depth", "normal", "segmentation", "material_id", "albedo"],
                      "status": "blocked_until_license_and_qa"}
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"generated {len(identities)} identity records: {output}")
    return 0


if __name__ == "__main__": raise SystemExit(main())
