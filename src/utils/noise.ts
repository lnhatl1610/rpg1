import * as THREE from 'three';

function hash2(x: number, y: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);

  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm2D(x: number, y: number, octaves = 4): number {
  let value = 0.0;
  let amplitude = 0.5;
  let frequency = 1.0;
  let norm = 0.0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * (valueNoise2D(x * frequency, y * frequency) * 2.0 - 1.0);
    norm += amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value / norm;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Generates a seamless tileable RGBAI noise texture for GPU wind waves & cloud shadows.
 */
export function createSeamlessNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);

  const tileNoise = (u: number, v: number, scale: number): number => {
    // Periodic wrap using 4-corner blend for seamless tiling
    const x = u * scale;
    const y = v * scale;
    const n00 = valueNoise2D(x, y);
    const n10 = valueNoise2D(x - scale, y);
    const n01 = valueNoise2D(x, y - scale);
    const n11 = valueNoise2D(x - scale, y - scale);
    const wx = smoothstep(0, 1, u);
    const wy = smoothstep(0, 1, v);
    return (n00 * (1 - wx) + n10 * wx) * (1 - wy) + (n01 * (1 - wx) + n11 * wx) * wy;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      const low = tileNoise(u, v, 4.0) * 0.65 + tileNoise(u, v, 8.0) * 0.35;
      const mid = tileNoise(u, v, 12.0) * 0.6 + tileNoise(u, v, 24.0) * 0.4;
      const detail = tileNoise(u, v, 32.0);

      const idx = (y * size + x) * 4;
      data[idx] = Math.floor(Math.max(0, Math.min(255, low * 255)));
      data[idx + 1] = Math.floor(Math.max(0, Math.min(255, mid * 255)));
      data[idx + 2] = Math.floor(Math.max(0, Math.min(255, detail * 255)));
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a crisp anime 4-point star / sparkle sprite texture on Canvas.
 */
export function createSparkleTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;

  ctx.clearRect(0, 0, size, size);

  // Soft core glow
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.22, 'rgba(255, 252, 235, 0.78)');
  grad.addColorStop(0.55, 'rgba(210, 240, 255, 0.22)');
  grad.addColorStop(1.0, 'rgba(200, 235, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Crisp 4-pointed anime star rays
  ctx.save();
  ctx.translate(half, half);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    const len = half * 0.94;
    const thick = half * 0.11;
    ctx.moveTo(0, -len);
    ctx.quadraticCurveTo(thick, -thick, len, 0);
    ctx.quadraticCurveTo(thick, thick, 0, len);
    ctx.quadraticCurveTo(-thick, thick, -len, 0);
    ctx.quadraticCurveTo(-thick, -thick, 0, -len);
    ctx.fill();
    ctx.rotate(Math.PI / 4);
    ctx.scale(0.52, 0.52);
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a painted anime cumulus puff sprite texture with crisp cotton edges.
 */
export function createCloudPuffTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const blobs = [
    { x: 0.5, y: 0.54, r: 0.34, a: 0.95 },
    { x: 0.34, y: 0.56, r: 0.26, a: 0.88 },
    { x: 0.66, y: 0.57, r: 0.25, a: 0.88 },
    { x: 0.44, y: 0.39, r: 0.25, a: 0.92 },
    { x: 0.58, y: 0.41, r: 0.22, a: 0.9 },
    { x: 0.26, y: 0.62, r: 0.18, a: 0.78 },
    { x: 0.74, y: 0.63, r: 0.18, a: 0.78 },
  ];

  for (const b of blobs) {
    const cx = b.x * size;
    const cy = b.y * size;
    const r = b.r * size;
    const g = ctx.createRadialGradient(cx, cy - r * 0.18, r * 0.08, cx, cy, r);
    // Encode vertical highlight in R, density in A
    g.addColorStop(0.0, `rgba(255, 255, 255, ${b.a})`);
    g.addColorStop(0.62, `rgba(236, 244, 255, ${b.a * 0.82})`);
    g.addColorStop(0.88, `rgba(205, 222, 248, ${b.a * 0.35})`);
    g.addColorStop(1.0, 'rgba(190, 212, 245, 0.0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a crisp Studio Ghibli / Genshin Windrise leaf-bouquet alpha texture!
 * R = outer leaf highlight factor, G = per-leaf tonal variation, A = crisp leaf cutout mask.
 */
export function createLeafBouquetTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const cx = size * 0.5;
  const cy = size * 0.52;

  // Draw 22 overlapping pointed anime leaves radiating in a lush cluster
  const leafCount = 22;
  for (let i = 0; i < leafCount; i++) {
    const ring = i < 8 ? 0 : i < 16 ? 1 : 2;
    const baseAngle =
      ring === 0
        ? (i / 8) * Math.PI * 2
        : ring === 1
        ? ((i - 8) / 8) * Math.PI * 2 + 0.38
        : ((i - 16) / 6) * Math.PI * 2 + 0.18;

    const dist =
      ring === 2
        ? size * 0.04
        : ring === 0
        ? size * 0.16
        : size * 0.23;

    const len = ring === 2 ? size * 0.22 : size * (0.24 + (i % 3) * 0.03);
    const wid = len * 0.46;

    const lx = cx + Math.cos(baseAngle) * dist;
    const ly = cy + Math.sin(baseAngle) * dist;

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(baseAngle + Math.PI * 0.5 + Math.sin(i * 4.1) * 0.22);

    const tone = Math.floor(175 + ((i * 37) % 75)); // 175..250
    const tip = ring === 1 ? 255 : ring === 0 ? 228 : 242;

    const grad = ctx.createLinearGradient(0, len * 0.45, 0, -len * 0.55);
    grad.addColorStop(0.0, `rgba(${Math.floor(tip * 0.65)}, ${tone}, 255, 0.98)`);
    grad.addColorStop(1.0, `rgba(${tip}, ${Math.min(255, tone + 18)}, 255, 1.0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, len * 0.42);
    ctx.bezierCurveTo(wid, len * 0.18, wid * 0.92, -len * 0.26, 0, -len * 0.56);
    ctx.bezierCurveTo(-wid * 0.92, -len * 0.26, -wid, len * 0.18, 0, len * 0.42);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
