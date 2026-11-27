import { drawExplosion, EXPLOSION_MS } from "./explosion-effect.js";

export function syncMissiles(sprites, state) {
  for (const id of sprites.keys()) {
    if (!state.has(id)) sprites.delete(id);
  }
  for (const [id, missile] of state) {
    let sprite = sprites.get(id);
    if (!sprite) {
      sprite = { id: `missile:${id}`, x: missile.x, y: missile.y, trail: [], owner: missile.owner, missile: true, nickname: "Ракета «Вихрь»" };
      sprites.set(id, sprite);
    }
    sprite.hp = missile.hp;
    sprite.targetX = missile.x;
    sprite.targetY = missile.y;
    sprite.heading = missile.heading;
  }
}

export function interpolateMissiles(sprites) {
  for (const missile of sprites.values()) {
    missile.x += (missile.targetX - missile.x) * 0.48;
    missile.y += (missile.targetY - missile.y) * 0.48;
  }
}

export function drawMissiles(context, sprites, impacts, width, height, originX, originY, time, flatModels) {
  context.save();
  context.lineCap = "round";
  let visible = false;
  for (const missile of sprites.values()) {
    const x = originX + missile.x;
    const y = originY + missile.y;
    if (x < -70 || x > width + 70 || y < -70 || y > height + 70) {
      missile.trail.length = 0;
      continue;
    }
    visible = true;
    const last = missile.trail.at(-1);
    if (!last || Math.hypot(missile.x - last.x, missile.y - last.y) > 5) {
      missile.trail.push({ x: missile.x, y: missile.y });
      if (missile.trail.length > 11) missile.trail.shift();
    }
    const trail = missile.trail;
    for (let i = 1; i < trail.length; i++) {
      context.strokeStyle = `rgba(179, 211, 180, ${0.45 * i / trail.length})`;
      context.lineWidth = 3 - 1.5 * i / trail.length;
      context.beginPath();
      context.moveTo(originX + trail[i - 1].x, originY + trail[i - 1].y);
      context.lineTo(originX + trail[i].x, originY + trail[i].y);
      context.stroke();
    }

    if (!flatModels) continue;
    context.save();
    context.translate(x, y);
    context.rotate(missile.heading);
    context.fillStyle = "#eaf0e6";
    context.beginPath();
    context.moveTo(0, -6);
    context.lineTo(2, -2);
    context.lineTo(2, 4);
    context.lineTo(-2, 4);
    context.lineTo(-2, -2);
    context.fill();
    context.fillStyle = "#a5ffb9";
    context.shadowColor = "#97ffba";
    context.shadowBlur = 6;
    context.fillRect(-1, 4, 2, 4);
    context.restore();
  }
  context.restore();

  for (let i = impacts.length - 1; i >= 0; i--) {
    const impact = impacts[i];
    const age = Math.max(0, time - impact.time);
    if (age >= (impact.explosion ? EXPLOSION_MS : 240)) {
      impacts.splice(i, 1);
    } else if (impact.explosion) {
      drawExplosion(context, originX + impact.explosion.x, originY + impact.explosion.y, age, time / 1000 - age / 1000);
    } else {
      context.save();
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = (1 - age / 240) ** 1.6;
      context.fillStyle = "#ffc879";
      context.shadowColor = "#ff8b36";
      context.shadowBlur = 10;
      context.beginPath();
      context.arc(originX + impact.x, originY + impact.y, 3 + age / 28, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }
  return visible || impacts.length > 0;
}
