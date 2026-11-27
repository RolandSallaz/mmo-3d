import { LASER_MODELS, WEAPON_MOUNTS } from "../shared/equipment.js";

import { laserAim } from "../shared/ship-geometry.js";

const HIT_RADIUS = 26;

export function fireLasers(player, target, readyAt, time, worldSize, hitRadius = HIT_RADIUS) {
  const shots = [];
  for (const [index, model] of WEAPON_MOUNTS.map(({ field }) => player[field]).entries()) {
    if (!Object.hasOwn(LASER_MODELS, model) || time < readyAt[index]) continue;

    const laser = LASER_MODELS[model];
    const { muzzle } = laserAim(player.heading, index, model, target.x - player.x, target.y - player.y);
    const x = Math.max(0, Math.min(worldSize, player.x + muzzle.x));
    const y = Math.max(0, Math.min(worldSize, player.y + muzzle.y));
    const dx = target.x - x;
    const dy = target.y - y;
    const distance = Math.hypot(dx, dy);
    const length = Math.max(0, distance - hitRadius);
    if (length > laser.range) continue;

    const fraction = distance ? length / distance : 0;
    shots.push({
      x, y, endX: x + dx * fraction, endY: y + dy * fraction, targetX: target.x, targetY: target.y,
      model, damage: laser.damage, slotIndex: index, cooldown: laser.cooldown,
    });
  }
  return shots;
}
