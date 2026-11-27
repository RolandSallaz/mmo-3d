import { LASER_MODELS } from "../shared/equipment.js";

import { drawExplosion, EXPLOSION_MS } from "./explosion-effect.js";

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
