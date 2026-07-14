'use strict';

/**
 * 최소 GLB(바이너리 glTF 2.0) 직렬화기.
 * 외부 라이브러리 없이 positions/colors/indices 메시를 GLB 로 패킹한다.
 * (COLOR_0 은 선형색이어야 하므로 색은 호출 측에서 sRGB→linear 변환해 넘긴다.)
 */

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

/**
 * @param {Float32Array} positions xyz*N
 * @param {Float32Array} colors    rgb*N (0~1, 선형)
 * @param {Uint32Array}  indices   삼각형 인덱스
 * @param {Float32Array} [normals] xyz*N (선택, 부드러운 셰이딩용)
 * @returns {Buffer} GLB
 */
function buildGLB(positions, colors, indices, normals) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }

  const idxBytes = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  const posBytes = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const colBytes = Buffer.from(colors.buffer, colors.byteOffset, colors.byteLength);
  const nrmBytes = normals ? Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength) : null;

  const parts = [];
  let offset = 0;
  const views = [];
  const addView = (buf, target) => {
    const p = pad4(offset);
    if (p) {
      parts.push(Buffer.alloc(p));
      offset += p;
    }
    const index = views.length;
    views.push({ byteOffset: offset, byteLength: buf.length, target });
    parts.push(buf);
    offset += buf.length;
    return index;
  };
  const idxView = addView(idxBytes, 34963); // ELEMENT_ARRAY_BUFFER
  const posView = addView(posBytes, 34962); // ARRAY_BUFFER
  const colView = addView(colBytes, 34962);
  const nrmView = nrmBytes ? addView(nrmBytes, 34962) : -1;

  const bin = Buffer.concat(parts);

  const vertCount = positions.length / 3;
  const accessors = [
    { bufferView: idxView, componentType: 5125, count: indices.length, type: 'SCALAR' },
    { bufferView: posView, componentType: 5126, count: vertCount, type: 'VEC3', min, max },
    { bufferView: colView, componentType: 5126, count: vertCount, type: 'VEC3' },
  ];
  const attributes = { POSITION: 1, COLOR_0: 2 };
  if (nrmBytes) {
    accessors.push({ bufferView: nrmView, componentType: 5126, count: vertCount, type: 'VEC3' });
    attributes.NORMAL = 3;
  }

  const gltf = {
    asset: { version: '2.0', generator: 'local-node-cpu' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes, indices: 0, material: 0, mode: 4 }] }],
    materials: [
      { name: 'relief', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: true },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views.map((v) => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength, target: v.target })),
    accessors,
  };

  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jp = pad4(jsonBuf.length);
  if (jp) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jp, 0x20)]); // 공백 패딩

  let binBuf = bin;
  const bp = pad4(binBuf.length);
  if (bp) binBuf = Buffer.concat([binBuf, Buffer.alloc(bp, 0)]);

  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuf.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
}

module.exports = { buildGLB };
