import { LASER_MODELS } from "../shared/equipment.js";

const EXPLOSION_MS = 850;
const DEBRIS_COUNT = 22;

function drawExplosion(context, x, y, age, seed) {
  const progress = age / EXPLOSION_MS;
  const radius = 8 + 65 * progress ** 0.7;
  context.save();
  context.globalCompositeOperation = "lighter";

  const flash = Math.max(0, 1 - progress * 3);
  if (flash > 0) {
    const glow = context.createRadialGradient(x, y, 0, x, y, radius + 12);
    glow.addColorStop(0, "rgba(255, 252, 226, 1)");
    glow.addColorStop(0.26, "rgba(255, 207, 105, 0.9)");
    glow.addColorStop(0.58, "rgba(255, 93, 27, 0.45)");
    glow.addColorStop(1, "rgba(255, 50, 12, 0)");
    context.globalAlpha = flash;
    context.fillStyle = glow;
    context.fillRect(x - radius - 12, y - radius - 12, (radius + 12) * 2, (radius + 12) * 2);
  }

  context.globalAlpha = 0.7 * (1 - progress) ** 2;
  context.strokeStyle = "#ffc278";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();

  context.lineCap = "round";
  for (let index = 0; index < DEBRIS_COUNT; index++) {
    const angle = seed + index * 2.39996;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const speed = 35 + (index * 37 % 85);
    const distance = 5 + speed * progress ** 0.8;
    const length = (4 + index % 9) * (1 - progress);
    context.strokeStyle = index % 3 === 0 ? "#fff1bc" : "#ff8835";
    context.globalAlpha = (1 - progress) ** (1 + index % 3 / 2);
    context.lineWidth = 1 + index % 3 * 0.65;
    context.beginPath();
    context.moveTo(x + dx * (distance - length), y + dy * (distance - length));
    context.lineTo(x + dx * distance, y + dy * distance);
    context.stroke();
  }
  context.restore();
}

export function receiveLaserShots(effects, shots, time) {
  for (const shot of shots) {
    const model = LASER_MODELS[shot.model];
    if (model) effects.push({ ...shot, time, modelId: shot.model, model });
  }
}

export function drawLaserShots(context, effects, originX, originY, time, getMuzzle) {
  for (let index = effects.length - 1; index >= 0; index--) {
    const shot = effects[index];
    const age = Math.max(0, time - shot.time);
    const lifetime = shot.explosion ? EXPLOSION_MS : shot.model.lifetime;
    if (age >= lifetime) {
      effects.splice(index, 1);
      continue;
    }

    if (shot.explosion) {
      drawExplosion(context, originX + shot.explosion.x, originY + shot.explosion.y, age, shot.time / 1000);
    }
    const progress = age / shot.model.lifetime;
    if (progress >= 1) continue;

    const opacity = (1 - progress) ** 1.35;
    const muzzle = getMuzzle(shot);
    const startX = originX + muzzle.x;
    const startY = originY + muzzle.y;
    const x = originX + shot.endX;
    const y = originY + shot.endY;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    context.strokeStyle = shot.model.color;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(x, y);
    context.lineWidth = 11;
    context.globalAlpha = 0.12 * opacity;
    context.stroke();
    context.lineWidth = 4;
    context.globalAlpha = 0.65 * opacity;
    context.stroke();
    context.strokeStyle = "#fff8ee";
    context.lineWidth = 1.4;
    context.globalAlpha = opacity;
    context.stroke();

    const flash = 1 - age / 75;
    if (flash > 0) {
      context.globalAlpha = flash;
      context.fillStyle = shot.model.color;
      context.shadowColor = shot.model.color;
      context.shadowBlur = 9;
      context.beginPath();
      context.arc(startX, startY, 2 + 2 * flash, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.globalAlpha = opacity;
    }

    if (shot.hit && !shot.explosion) {
      const radius = 18 * progress + 3;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.strokeStyle = shot.model.color;
      context.lineWidth = 1.2;
      context.stroke();

      context.beginPath();
      for (let spark = 0; spark < 5; spark++) {
        const angle = spark * 2.4 + shot.time / 1000;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        context.moveTo(x + dx * radius * 0.45, y + dy * radius * 0.45);
        context.lineTo(x + dx * radius, y + dy * radius);
      }
      context.stroke();
    }
    context.restore();
  }
  return effects.length > 0;
}
