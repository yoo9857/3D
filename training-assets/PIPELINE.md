# Identity3D 고정밀 데이터 레이아웃

원본과 우리 기술 산출물을 섞지 않는다. 각 샘플은 `sample_id`와
`identity_id`를 유지하고, 모든 파생 파일은 manifest에서 원본 SHA-256으로
역추적한다.

| 폴더 | 역할 | 허용 산출물 |
|---|---|---|
| `00_reference` | 라이선스, 촬영 기준, 카테고리 정의 | PDF/URL/메모 |
| `01_source_archives` | CC0/승인 원본 | `.max`, `.blend`, `.zip` |
| `02_max_derivatives` | 통제된 3ds Max import 결과 | 버전별 `.max` |
| `03_normalized_scene` | 단위·좌표·토폴로지 정규화 | mesh, UV, material |
| `04_supervision` | RGB/depth/normal/segmentation/material ID | view별 이미지 |
| `05_identity3d_ovoxel` | O-Voxel과 identity feature | `.npz`, metadata |
| `06_qa_reports` | 누락 텍스처·비매니폴드·UV·중복 검사 | JSON/HTML |
| `07_release_manifests` | 학습/검증/테스트 분할 | JSONL |

3ds Max 작업 순서는 `import → scale/axis normalize → material relink →
T/A-pose 및 카메라 세트 → 6종 render pass → QA → O-Voxel 변환`이다.
사람 데이터는 identity 단위로 split하여 동일 인물이 train/test에 섞이지
않게 한다. `.max` 자체를 학습 입력으로 사용하지 않는다.

자동화 파일:

- `02_max_derivatives/Identity3D_Export.ms`: 정규화 derivative export
- `02_max_derivatives/Identity3D_Render.ms`: orbit camera와 6종 supervision
- `python ml/mesh_qa.py <mesh> <report.json>`: mesh 품질 gate
- `python ml/texture_reproject.py <source.obj> <repaired.glb> <texture.png> <output.glb>`: UV/texture 재투영
- `python ml/validate_manifest.py <samples.jsonl>`: release gate
