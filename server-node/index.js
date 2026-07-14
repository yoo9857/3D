'use strict';

/**
 * CPU 전용 로컬 image→3D 서버 (Node).
 * GPU·API 키 불필요. 이 컴퓨터에서 바로 실행 가능한 "작은 첫걸음".
 *
 * 계약(웹앱과 동일):
 *   POST /generate  (multipart/form-data, field: image) → GLB 바이너리
 *
 * 실행:
 *   cd server-node && npm install && npm start
 *   웹앱 "생성 서버 URL" 에 http://localhost:8000/generate 입력
 */

const express = require('express');
const multer = require('multer');
const Jimp = require('jimp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { buildReliefGLB } = require('./lib/relief');

// TripoSR (실제 image→3D 모델) 실행 경로
const TRIPOSR_PY = process.env.TRIPOSR_PY || 'C:\\3D\\ml\\.venv\\Scripts\\python.exe';
const TRIPOSR_INFER = process.env.TRIPOSR_INFER || 'C:\\3D\\ml\\infer.py';
const IDENTITY_POSTPROCESS = process.env.IDENTITY_POSTPROCESS || 'C:\\3D\\ml\\identity_postprocess.py';

const app = express();

// 브라우저(다른 오리진)에서 호출 허용
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', backend: 'node-cpu-relief' });
});

/** 부조(relief) 폴백: TripoSR 없이 CPU 로 즉시 GLB 생성. */
async function reliefFromBuffer(buffer, query) {
  const img = await Jimp.read(buffer);
  const opts = {};
  if (query.depth) opts.depthScale = parseFloat(String(query.depth));
  if (query.res) opts.resolution = parseInt(String(query.res), 10);
  return buildReliefGLB(img.bitmap, opts);
}

/**
 * TripoSR 로컬 추론: 임시 이미지 저장 → infer.py(spawn) → GLB 바이트 반환.
 * onProgress(frac, msg) 로 infer.py 의 `@P` 진행률 라인을 실시간 중계한다.
 */
function runTripoSR(buffer, mcRes, onProgress) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(TRIPOSR_PY) || !fs.existsSync(TRIPOSR_INFER)) {
      reject(new Error('TripoSR 미설치(python/infer.py 경로 없음)'));
      return;
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'triposr-'));
    const inPath = path.join(work, 'in.png');
    const outPath = path.join(work, 'out.glb');
    fs.writeFileSync(inPath, buffer);
    const args = [TRIPOSR_INFER, inPath, outPath, String(mcRes)];

    const child = spawn(TRIPOSR_PY, args, { windowsHide: true });
    let stderrTail = '';
    let stdoutBuf = '';

    const handleLine = (line) => {
      const m = line.match(/^@P\s+([0-9.]+)\s+(.*)$/);
      if (m && onProgress) onProgress(Math.max(0, Math.min(1, parseFloat(m[1]))), m[2].trim());
    };
    child.stdout.on('data', (d) => {
      stdoutBuf += d.toString();
      let nl;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        handleLine(stdoutBuf.slice(0, nl).replace(/\r$/, ''));
        stdoutBuf = stdoutBuf.slice(nl + 1);
      }
    });
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-1200);
    });

    const done = (fn) => {
      try {
        fs.rmSync(work, { recursive: true, force: true });
      } catch (_e) {
        /* ignore cleanup error */
      }
      fn();
    };
    // CPU 추론은 수 분 걸릴 수 있음 → 넉넉한 타임아웃
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      done(() => reject(new Error(`TripoSR 실행 실패: ${e.message}`)));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        done(() => reject(new Error(`TripoSR 실패(code ${code}): ${stderrTail.slice(-800)}`)));
        return;
      }
      if (!fs.existsSync(outPath)) {
        done(() => reject(new Error('TripoSR 출력 GLB 없음')));
        return;
      }
      const buf = fs.readFileSync(outPath);
      done(() => resolve(buf));
    });
  });
}

function runIdentity3D(buffer, mcRes, onProgress) {
  return runTripoSR(buffer, mcRes, onProgress).then((raw) => new Promise((resolve, reject) => {
    if (!fs.existsSync(IDENTITY_POSTPROCESS)) return reject(new Error('Identity3D postprocess.py not found'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'identity3d-'));
    const input = path.join(work, 'input.glb');
    const texture = path.join(work, 'source-image.png');
    const output = path.join(work, 'identity.glb');
    fs.writeFileSync(input, raw);
    fs.writeFileSync(texture, buffer);
    const child = spawn(TRIPOSR_PY, [IDENTITY_POSTPROCESS, input, output, texture], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-1200); });
    const finish = (fn) => { try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {} fn(); };
    child.on('error', (e) => finish(() => reject(e)));
    child.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(output)) return finish(() => reject(new Error(`Identity3D failed: ${stderr}`)));
      const result = fs.readFileSync(output);
      finish(() => resolve(result));
    });
  }));
}

/** 이미지 → { glb: Buffer, backend } (진행률은 onProgress 로 중계). */
async function generateGLB(buffer, query, onProgress) {
  const mode = String(query.mode || 'triposr').toLowerCase();
  const mcRes = query.mc ? parseInt(String(query.mc), 10) : (mode === 'identity' ? 384 : 256);

  if (mode === 'relief') {
    onProgress?.(0.3, '부조 메시 생성 중…');
    const glb = await reliefFromBuffer(buffer, query);
    onProgress?.(1.0, '완료');
    return { glb, backend: 'node-cpu-relief' };
  }
  if (mode === 'identity') {
    onProgress?.(0.1, 'Identity3D O-Voxel reconstruction');
    const glb = await runIdentity3D(buffer, mcRes, onProgress);
    onProgress?.(1.0, 'Identity3D complete');
    return { glb, backend: 'identity3d-ovoxel-local' };
  }
  try {
    const glb = await runTripoSR(buffer, mcRes, onProgress);
    return { glb, backend: 'triposr-cpu' };
  } catch (e) {
    // TripoSR 실패 시 부조로 폴백(웹앱이 최소한 결과는 받도록)
    console.warn('[generate] TripoSR 폴백 → relief:', (e && e.message) || e);
    onProgress?.(0.3, `TripoSR 사용 불가 → 부조로 대체 중… (${(e && e.message) || e})`);
    const glb = await reliefFromBuffer(buffer, query);
    onProgress?.(1.0, '완료');
    return { glb, backend: 'node-cpu-relief(fallback)' };
  }
}

app.post('/generate', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'image 필드가 없습니다.' });
    return;
  }

  // ?stream=1 : NDJSON 진행률 스트림(마지막 줄에 base64 GLB). 아니면 기존 바이너리 응답.
  const streaming = String(req.query.stream || '') === '1';

  if (!streaming) {
    try {
      const { glb, backend } = await generateGLB(req.file.buffer, req.query);
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.setHeader('X-Backend', backend);
      res.send(glb);
    } catch (err) {
      res.status(500).json({ error: String((err && err.message) || err) });
    }
    return;
  }

  // ---- 스트리밍(NDJSON) ----
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  // 실제 진행 지점 사이의 긴 공백(특히 3D 추론)에서 막대가 멈춘 듯 보이지 않도록,
  // 다음 목표치까지 조금씩 차오르는 하트비트.
  let cur = 0;
  let target = 0.03;
  let lastMsg = '준비 중…';
  send({ progress: cur, stage: lastMsg });
  const heartbeat = setInterval(() => {
    if (cur < target) {
      cur += (target - cur) * 0.12; // 지수적으로 목표에 접근(도달은 안 함)
      send({ progress: Math.min(cur, target), stage: lastMsg, heartbeat: true });
    }
  }, 1200);

  const onProgress = (frac, msg) => {
    lastMsg = msg;
    cur = Math.max(cur, frac);
    // 다음 실제 지점까지 하트비트가 향할 목표(마지막 단계면 그대로).
    target = frac >= 1 ? 1 : Math.min(0.99, frac + 0.38);
    send({ progress: cur, stage: msg });
  };

  try {
    const { glb, backend } = await generateGLB(req.file.buffer, req.query, onProgress);
    clearInterval(heartbeat);
    send({ done: true, backend, progress: 1, stage: '완료', glbBase64: glb.toString('base64') });
    res.end();
  } catch (err) {
    clearInterval(heartbeat);
    send({ error: String((err && err.message) || err) });
    res.end();
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`[local-image-to-3d] CPU 서버 실행: http://localhost:${PORT}/generate`);
});
