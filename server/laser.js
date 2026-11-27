import { LASER_MODELS } from "../shared/equipment.js";

import { laserMuzzle } from "../shared/ship-geometry.js";

const HIT_RADIUS = 26;

export function fireLasers(player, target, readyAt, time, worldSize) {
  const shots = [];
  const forwardX = Math.sin(player.heading);
  const forwardY = -Math.cos(player.heading);
  for (const [index, model] of [player.weaponLeft, player.weaponRight].entries()) {
    if (!Object.hasOwn(LASER_MODELS, model) || time < readyAt[index]) continue;

    const laser = LASER_MODELS[model];
    const muzzle = laserMuzzle(player.heading, index, model);
    const x = Math.max(0, Math.min(worldSize, player.x + muzzle.x));
    const y = Math.max(0, Math.min(worldSize, player.y + muzzle.y));
    const dx = target.x - x;
    const dy = target.y - y;
    const distance = Math.hypot(dx, dy);
    if (laser.fireCone !== undefined) {
      const forward = dx * forwardX + dy * forwardY;
      const minimum = distance * Math.cos(laser.fireCone * Math.PI / 360);
      if (distance === 0 || forward + 1e-6 < minimum) continue;
    }
    const length = Math.max(0, distance - HIT_RADIUS);
    if (length > laser.range) continue;

    const fraction = distance ? length / distance : 0;
    shots.push({
      x, y, endX: x + dx * fraction, endY: y + dy * fraction,
      model, damage: laser.damage, slotIndex: index, cooldown: laser.cooldown,
    });
  }
  return shots;
}
