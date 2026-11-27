import { LASER_MODELS } from "../shared/equipment.js";

export function receiveLaserShots(effects, shots, time) {
  for (const shot of shots) {
    const model = LASER_MODELS[shot.model];
    if (model) effects.push({ ...shot, time, model });
  }
}

export function drawLaserShots(context, effects, originX, originY, time) {
  for (let index = effects.length - 1; index >= 0; index--) {
    const shot = effects[index];
    const progress = Math.max(0, (time - shot.time) / shot.model.lifetime);
    if (progress >= 1) {
      effects.splice(index, 1);
      continue;
    }

    const opacity = (1 - progress) ** 1.35;
    const x = originX + shot.endX;
    const y = originY + shot.endY;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    context.strokeStyle = shot.model.color;
    context.beginPath();
    context.moveTo(originX + shot.x, originY + shot.y);
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

    if (shot.hit) {
      const radius = (shot.destroyed ? 43 : 18) * progress + 3;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.strokeStyle = shot.model.color;
      context.lineWidth = shot.destroyed ? 2.5 : 1.2;
      context.stroke();

      context.beginPath();
      for (let spark = 0; spark < (shot.destroyed ? 10 : 5); spark++) {
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
