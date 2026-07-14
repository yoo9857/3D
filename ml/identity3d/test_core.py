import unittest
import numpy as np

from identity3d import OVoxel, OVoxelConfig
from identity3d.flexgemm import sparse_neighbor_aggregate


class IdentityCoreTests(unittest.TestCase):
    def test_ovoxel_dense_round_trip_preserves_xyz(self):
        dense = np.zeros((8, 8, 8, 6), np.float32)
        dense[1, 6, 3, :3] = [0.2, 0.4, 0.8]
        sparse = OVoxel.from_dense(dense)
        np.testing.assert_array_equal(sparse.coords, [[1, 6, 3]])
        np.testing.assert_allclose(sparse.dense(), dense)

    def test_surface_mesh_is_watertight_cube_shell(self):
        sparse = OVoxel(np.array([[2, 3, 4]], np.int32), np.ones((1, 6), np.float32), 8)
        vertices, faces, colors = sparse.to_mesh()
        self.assertEqual(vertices.shape[1], 3)
        self.assertEqual(faces.shape[1], 3)
        self.assertGreaterEqual(len(vertices), 6)
        self.assertGreaterEqual(len(faces), 8)
        self.assertEqual(colors.shape, vertices.shape)

    def test_sparse_neighbor_fallback(self):
        import torch
        coords = torch.tensor([[0, 0, 0], [1, 0, 0]])
        features = torch.tensor([[1.0], [3.0]])
        out = sparse_neighbor_aggregate(coords, features)
        torch.testing.assert_close(out, torch.tensor([[2.0], [2.0]]))


if __name__ == "__main__":
    unittest.main()
