"""Reject incomplete Identity3D records before a training release."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REQUIRED = ("sample_id", "category", "identity_id", "license", "source", "geometry", "views", "qa")
QA_REQUIRED = ("missing_textures", "non_manifold", "uv_coverage", "leakage_check")


def validate(record: dict, root: Path) -> list[str]:
    errors = [f"missing {key}" for key in REQUIRED if key not in record]
    if not isinstance(record.get("views"), list) or not record.get("views"):
        errors.append("views must be a non-empty list")
    for key in QA_REQUIRED:
        if key not in record.get("qa", {}): errors.append(f"missing qa.{key}")
    for source in record.get("source", {}).get("original_files", []):
        if not (root / source).exists(): errors.append(f"missing source file: {source}")
    geometry = record.get("geometry", {})
    for key in ("normalized_mesh", "units", "coordinate_system", "watertight"):
        if key not in geometry: errors.append(f"missing geometry.{key}")
    return errors


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "training-assets/07_release_manifests/samples.jsonl")
    root = Path(sys.argv[2] if len(sys.argv) > 2 else "training-assets")
    if not path.exists():
        print(f"manifest not found: {path}")
        return 2
    failures = 0
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip(): continue
        try: record = json.loads(line)
        except json.JSONDecodeError as exc:
            print(f"line {line_no}: invalid JSON: {exc}"); failures += 1; continue
        errors = validate(record, root)
        if errors:
            failures += 1
            print(f"line {line_no} ({record.get('sample_id', '?')}): " + "; ".join(errors))
    print(f"validated records; failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
