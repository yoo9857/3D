# Seed 3ds Max dataset

This directory contains three **CC0 1.0** source archives selected as a small, legally reusable seed set for the Identity3D data pipeline. They are not sufficient to train a production-grade 2D-to-3D foundation model; use them to validate ingestion, scene inspection, normalization, and supervision extraction.

| Asset | Source contents | What it contributes | Source / license |
| --- | --- | --- | --- |
| `cc0_vw_corrado.zip` | `vw5.max`, `vw6.max` | Symmetric curved hard-surface body, UVs, normal/bump map | [OpenGameArt — Car VW Corradon](https://opengameart.org/content/car-vw-corradon), CC0 1.0 |
| `cc0_cpu_models.zip` | `cpu2017.max`, `cpu2018.max`, `cpu2019.max`, `cpu2020.max` | Grouped hard-surface objects, editable labels, textures, Max 2017–2020 variants | [OpenGameArt — Free 3D Models CPU](https://opengameart.org/content/free-3d-models-cpu), CC0 1.0 |
| `cc0_computer_case.zip` | `Computer Case/Computer Case.max` | Separable prop hierarchy and a compact Max source scene | [OpenGameArt — Computer, Monitor, and Desk](https://opengameart.org/content/3d-model-of-a-computer-monitor-and-desk), CC0 1.0 |

| `cc0_human_male_rigged.blend`, `.obj`, `_texture.png` | `male_3d.blend`, `male_3d.obj`, `char_texture.png` | Rigged adult male, quad topology, 1024 diffuse texture, subdivision weights; strong human-category seed | [OpenGameArt — 3D male](https://opengameart.org/content/3d-male-0), CC0 1.0 |

## Human asset provenance

`cc0_human_male_*` is an upstream Blender/OBJ source, not a native `.max` scene. It is deliberately kept alongside its texture so the controlled Max worker can import it, retain the rig/material relationship, and save an auditable `.max` derivative. It is **not** a claim that the current seed alone is production-grade or representative across people.

| File | SHA-256 |
| --- | --- |
| `cc0_human_male_rigged.blend` | `8d0adaf7fe998272dd980697ec450eed1796fe156cdd6dbda55215d9d22ef766` |
| `cc0_human_male_rigged.obj` | `1c6fab3a1896f7eaa00192f45899339818c483be80b521647a358a5c85beeb5a` |
| `cc0_human_male_texture.png` | `6beeaab2942c559d3e1ace61269bcc373091accf8b82d3a08d925842aa1afc77` |

### SSS-grade ingestion bar for people

1. Import the `.blend` into licensed 3ds Max, preserving bones, quad mesh, material and diffuse map; save a versioned `.max` derivative.
2. Produce a standardized T-pose/A-pose record plus diverse poses, focal lengths and 360° views. Render RGB, depth, normals, segmentation, albedo and material IDs.
3. Run automated checks for missing texture paths, non-manifold geometry, rig/weight corruption, unit scale, UV coverage, view leakage and duplicate identities.
4. Scale the category with licensed, consented human sources across age appearance, body shape, skin tone, clothing, hair, pose and lighting. Maintain provenance and release/consent records per identity.

## Required next stage

Do not train directly on `.max` binaries. Use licensed 3ds Max in a controlled worker to export normalized geometry and material metadata, then build paired training records:

`scene/mesh + UV + material maps + camera views + depth/normal/segmentation renders -> Identity3D training sample`

Keep this manifest and the original archive names with every derived sample so source and license provenance remain auditable.

The controlled-worker layout and release gates are documented in `PIPELINE.md`.
Use `python ml/dataset_audit.py training-assets` for inventory and
`python ml/validate_manifest.py training-assets/07_release_manifests/samples.jsonl`
before exporting a training split.
