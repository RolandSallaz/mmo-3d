const TEXTURE_SIZE = 768;
const CORONA_SCALE = 1.56;
const ROTATION_MS = 120_000;
const TWO_PI = 2 * Math.PI;
export const SUN_GLOW_SCALE = 1.85;

function hash(x, y) {
  const bits = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
  return (Math.imul(bits ^ (bits >>> 13), 1274126177) >>> 0) / 4294967296;
}

function noise(x, y) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const s = x - i;
  const t = y - j;
  const u = s * s * (3 - 2 * s);
  const v = t * t * (3 - 2 * t);
  const top = hash(i, j) * (1 - u) + hash(i + 1, j) * u;
  const bottom = hash(i, j + 1) * (1 - u) + hash(i + 1, j + 1) * u;
  return top * (1 - v) + bottom * v;
}

function createSunTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const { data } = image;
  const unit = 2 * CORONA_SCALE / TEXTURE_SIZE;

  for (let row = 0, index = 0; row < TEXTURE_SIZE; row++) {
    const y = (row + 0.5) * unit - CORONA_SCALE;
    for (let column = 0; column < TEXTURE_SIZE; column++, index += 4) {
      const x = (column + 0.5) * unit - CORONA_SCALE;
      const radius = Math.hypot(x, y);
      if (radius >= CORONA_SCALE) continue;

      data[index] = 255;
      if (radius < 1) {
        const depth = Math.sqrt(1 - radius * radius);
        const flow = noise(x * 8 + 34, y * 8 + 28);
        const bands = noise(x * 27 + flow * 3, y * 35 - flow * 3);
        const granules = Math.abs(2 * noise(x * 125 + bands, y * 125) - 1);
        const heat = flow * 0.34 + bands * 0.34 + granules * 0.32;
        const rim = Math.exp((radius - 1) * 145);
        data[index + 1] = 74 + 74 * depth + 106 * heat + 75 * rim;
        data[index + 2] = 12 + 40 * depth + 92 * heat ** 2 + 83 * rim;
        data[index + 3] = 110 + 145 * Math.min(1, (1 - radius) / unit);
      } else {
        const distance = radius - 1;
        const angle = Math.atan2(y, x);
        const plume = noise(41 + Math.cos(angle) * 15, 41 + Math.sin(angle) * 15);
        const stream = plume ** 3 * Math.exp(-distance * (7 + (1 - plume) * 24));
        data[index + 1] = 70 + 92 * Math.exp(-distance * 19);
        data[index + 2] = 17 + 49 * Math.exp(-distance * 27);
        data[index + 3] = (93 * Math.exp(-distance * 23) + 133 * stream) *
          (1 - distance / (CORONA_SCALE - 1));
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function createRayTexture() {
  const canvas = document.createElement("canvas");
  const width = canvas.width = 256;
  const height = canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const heat = ctx.createLinearGradient(0, 0, width, 0);
  heat.addColorStop(0, "#ffe2a2d0");
  heat.addColorStop(0.26, "#ffac586a");
  heat.addColorStop(0.65, "#ff702b29");
  heat.addColorStop(1, "#ff702b00");
  ctx.fillStyle = heat;
  for (const spread of [44, 19, 7]) {
    ctx.beginPath();
    ctx.moveTo(0, height / 2 - spread);
    ctx.bezierCurveTo(width * 0.26, height / 2 - spread * 0.12, width * 0.63, height / 2 - spread * 0.7,
      width, height / 2 - spread * 0.3);
    ctx.bezierCurveTo(width * 0.58, height / 2 - spread * 0.36, width * 0.22, height / 2 + spread * 0.12,
      0, height / 2 + spread);
    ctx.fill();
  }
  return canvas;
}

export function createSunRenderer() {
  const disk = createSunTexture();
  const rayTexture = createRayTexture();
  const rays = Array.from({ length: 17 }, (_, index) => ({
    angle: (index + 0.7 * hash(index, 7)) * TWO_PI / 17,
    length: 0.23 + 0.48 * hash(index, 14),
    width: 0.035 + 0.085 * hash(index, 21),
    phase: TWO_PI * hash(index, 28),
    frequency: 0.7 + 0.53 * hash(index, 35),
  }));
  return (ctx, x, y, radius, time) => {
    const angle = (time % ROTATION_MS) * TWO_PI / ROTATION_MS;
    const seconds = time / 1000;
    const glow = radius * CORONA_SCALE;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = "screen";
    for (const ray of rays) {
      const wave = seconds * ray.frequency + ray.phase;
      const pulse = 0.5 + 0.5 * Math.sin(wave);
      const tilt = ray.angle + 0.043 * Math.sin(wave * 0.81);
      const width = ray.width * radius;
      ctx.save();
      ctx.rotate(tilt);
      ctx.globalAlpha = 0.26 + 0.55 * pulse;
      ctx.drawImage(rayTexture, radius * 0.98, -width / 2, ray.length * radius * (0.68 + 0.32 * pulse), width);
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(disk, -glow, -glow, glow * 2, glow * 2);
    ctx.restore();
  };
}
