export const EXPLOSION_MS = 1550;

function cloud(context, x, y, size, stops) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, size);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(x - size, y - size, 2 * size, 2 * size);
}

const smoke = [[0, "rgba(69, 60, 68, .58)"], [0.52, "rgba(46, 40, 51, .4)"], [1, "rgba(30, 26, 38, 0)"]];
const fire = [[0, "#fff6d5"], [0.22, "rgba(255, 203, 105, .92)"],
  [0.55, "rgba(235, 84, 22, .61)"], [1, "rgba(184, 41, 6, 0)"]];

export function drawExplosion(context, x, y, age, seed) {
  const progress = age / EXPLOSION_MS;
  if (progress >= 1) return;
  context.save();
  context.globalAlpha = Math.sin(Math.PI * progress ** 0.65) * 0.82;
  for (let i = 0; i < 9; i++) {
    const angle = seed + i * 2.39996;
    const drift = (13 + i * 3.2) * Math.sqrt(progress);
    cloud(context, x + Math.cos(angle) * drift, y + Math.sin(angle) * drift,
      12 + progress * (19 + i % 4 * 3), smoke);
  }

  context.globalCompositeOperation = "lighter";
  context.globalAlpha = Math.max(0, 1 - age / 160) ** 1.4;
  if (context.globalAlpha > 0) cloud(context, x, y, 48 + age * 0.08, fire);
  for (let i = 0; i < 7; i++) {
    const phase = (age - i * 15) / (260 + i * 21);
    if (phase < 0 || phase >= 1) continue;
    const angle = seed - i * 2.21;
    const distance = (9 + i * 5) * phase ** 0.7;
    context.globalAlpha = (1 - phase) ** 1.6 * 0.77;
    cloud(context, x + Math.cos(angle) * distance, y + Math.sin(angle) * distance,
      8 + phase * (18 + i % 3 * 4), fire);
  }

  for (let i = 0; i < 23; i++) {
    const angle = seed + i * 2.39996;
    const distance = (42 + i * 23 % 102) * (1 - Math.exp(-progress * 2.5));
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const px = x + dx * distance;
    const py = y + dy * distance;
    context.globalAlpha = (1 - progress) ** (1.3 + i % 4 * 0.2);
    if (i < 8) {
      context.globalCompositeOperation = "source-over";
      context.save();
      context.translate(px, py);
      context.rotate(angle + progress * (i + 4));
      context.fillStyle = ["#cf9e7a", "#626d81", "#ad7255"][i % 3];
      context.beginPath();
      context.moveTo(-2 - i % 3, -1);
      context.lineTo(2, -2);
      context.lineTo(4 + i % 2, 1);
      context.lineTo(-1, 2);
      context.fill();
      context.restore();
    } else {
      context.globalCompositeOperation = "lighter";
      const tail = (5 + i % 9) * (1 - progress);
      context.strokeStyle = i % 4 ? "#ff7026" : "#fff0b2";
      context.lineWidth = i % 4 ? 0.9 : 1.5;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(px - dx * tail, py - dy * tail);
      context.lineTo(px, py);
      context.stroke();
    }
  }
  context.restore();
}
