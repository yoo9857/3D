"""Gate human samples on consent, identity isolation and supervision completeness."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REQUIRED = ("sample_id", "identity_id", "consent_id", "source_tier", "views", "passes", "qa")
PASSES = ("rgb", "depth", "normal", "segmentation", "material_id", "albedo")
QA = ("watertight", "uv_coverage", "missing_texture", "rig_integrity", "duplicate_identity")


def check(record: dict) -> list[str]:
    errors = [f"missing {key}" for key in REQUIRED if not record.get(key)]
    if record.get("source_tier") == "proprietary_consented" and not record.get("consent_id"):
        errors.append("proprietary sample requires consent_id")
    absent = [name for name in PASSES if name not in record.get("passes", [])]
    errors.extend(f"missing pass {name}" for name in absent)
    errors.extend(f"missing qa.{name}" for name in QA if name not in record.get("qa", {}))
    if record.get("qa", {}).get("duplicate_identity") is not False:
        errors.append("duplicate_identity must be false")
    return errors


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("training-assets/07_release_manifests/human.jsonl")
    failures = 0
    for line, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip(): continue
        record = json.loads(raw)
        errors = check(record)
        if errors:
            failures += 1
            print(f"line {line} ({record.get('sample_id', '?')}): " + "; ".join(errors))
    print(f"human records checked; failures={failures}")
    return int(bool(failures))


if __name__ == "__main__": raise SystemExit(main())
