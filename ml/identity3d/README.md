# Identity3D core

This is the project-owned geometry layer. It does not call TRELLIS, Replicate
or another hosted API.

`OVoxel` is the stable intermediate representation: sparse integer coordinates
plus RGB/normal/learned features. `IdentityPipeline` owns the bidirectional
mesh conversion and post-processing contract. `flexgemm.py` is the sparse
neighbor/convolution boundary (PyTorch CPU reference now, Triton/CUDA kernel
later), and `cumesh.py` is the remesh/decimation/UV boundary (trimesh CPU
reference now, CuMesh kernel later).

The CPU implementations are correctness references, not production training
throughput. The next training stage should export normalized 3ds Max records
and supervise occupancy, surface normals, material IDs and identity features
in this representation.
