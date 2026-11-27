import { LASER_MODELS } from "../shared/equipment.js";

const MOUNTS = [
  { slot: "weapon-left", side: -1 },
  { slot: "weapon-right", side: 1 },
];

function limitToWorld(origin, direction, worldSize) {
  if (direction > 0) return (worldSize - origin) / direction;
  if (direction < 0) return -origin / direction;
  return Infinity;
}

export function fireLasers(player, aim, weapons, readyAt, time, targets, worldSize) {
  const shots = [];
  const forwardX = Math.sin(player.heading);
  const forwardY = -Math.cos(player.heading);
  for (const [index, { slot, side }] of MOUNTS.entries()) {
    const model = weapons?.[slot];
    if (!Object.hasOwn(LASER_MODELS, model) || time < readyAt[index]) continue;

    const laser = LASER_MODELS[model];
    const x = Math.max(0, Math.min(worldSize, player.x + forwardX * 11 - forwardY * side * 14));
    const y = Math.max(0, Math.min(worldSize, player.y + forwardY * 11 + forwardX * side * 14));
    const dx = aim.x - x;
    const dy = aim.y - y;
    const distance = Math.hypot(dx, dy);
    if (distance < 2) continue;

    const rayX = dx / distance;
    const rayY = dy / distance;
    let length = Math.min(laser.range, limitToWorld(x, rayX, worldSize), limitToWorld(y, rayY, worldSize));
    if (length <= 0) continue;
    let hit;

    for (const target of targets) {
      if (!target.ship.hp) continue;
      const offsetX = target.ship.x - x;
      const offsetY = target.ship.y - y;
      const projected = offsetX * rayX + offsetY * rayY;
      const perpendicular = offsetX * rayY - offsetY * rayX;
      const radius = 26;
      if (Math.abs(perpendicular) > radius) continue;
      const halfChord = Math.sqrt(radius ** 2 - perpendicular ** 2);
      if (projected + halfChord < 0) continue;
      const intersection = Math.max(0, projected - halfChord);
      if (intersection <= length) {
        length = intersection;
        hit = target;
      }
    }

    readyAt[index] = time + laser.cooldown;
    shots.push({ x, y, endX: x + rayX * length, endY: y + rayY * length, model, target: hit, damage: laser.damage });
  }
  return shots;
}
