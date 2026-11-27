import { MISSILE_MODEL, WEAPON_MOUNTS } from "../shared/equipment.js";
import { MISSILE_TUBES, missileMuzzle } from "../shared/ship-geometry.js";

const BOOST_SPEED = 112;
const CRUISE_SPEED = 255;
const SPREAD = Math.PI / 2.9;
const TURN_RATE = 7.4;
const LAUNCH_TIME = 0.42;
const LIFETIME = 12;
const HIT_RADIUS = 20;

export function missileSalvos(player, target, readyAt, time, worldSize, budget = Infinity) {
  const salvos = [];
  for (const [slot, weapon] of WEAPON_MOUNTS.map(({ field }) => player[field]).entries()) {
    if (weapon !== "missile" || time < readyAt[slot] || salvos.length + MISSILE_MODEL.salvo > budget) continue;
    const offset = missileMuzzle(player.heading, slot, [0, 0.34]);
    const x = Math.max(0, Math.min(worldSize, player.x + offset.x));
    const y = Math.max(0, Math.min(worldSize, player.y + offset.y));
    if (Math.hypot(target.x - x, target.y - y) > MISSILE_MODEL.range) continue;
    readyAt[slot] = time + MISSILE_MODEL.cooldown;
    for (const [index, tube] of MISSILE_TUBES.entries()) {
      const muzzle = missileMuzzle(player.heading, slot, tube);
      salvos.push({
        x: Math.max(0, Math.min(worldSize, player.x + muzzle.x)),
        y: Math.max(0, Math.min(worldSize, player.y + muzzle.y)),
        heading: player.heading + SPREAD * (index / (MISSILE_MODEL.salvo - 1) - 0.5),
      });
    }
  }
  return salvos;
}

export function advanceMissile(missile, target, age, seconds, worldSize) {
  if (!target?.hp || target.online === false || age >= LIFETIME) return "expired";

  if (age >= LAUNCH_TIME) {
    const bearing = Math.atan2(target.x - missile.x, missile.y - target.y);
    const difference = bearing - missile.heading;
    const turn = Math.atan2(Math.sin(difference), Math.cos(difference));
    const limit = TURN_RATE * seconds;
    missile.heading += Math.max(-limit, Math.min(limit, turn));
  }

  const previousX = missile.x;
  const previousY = missile.y;
  const step = (age < LAUNCH_TIME ? BOOST_SPEED : CRUISE_SPEED) * seconds;
  const vx = Math.sin(missile.heading) * step;
  const vy = -Math.cos(missile.heading) * step;
  missile.x += vx;
  missile.y += vy;

  if (missile.x < 0 || missile.x > worldSize || missile.y < 0 || missile.y > worldSize) return "expired";
  if (!step) return "flying";
  const dx = target.x - previousX;
  const dy = target.y - previousY;
  const projected = Math.max(0, Math.min(1, (dx * vx + dy * vy) / (step * step)));
  return Math.hypot(dx - vx * projected, dy - vy * projected) <= HIT_RADIUS ? "hit" : "flying";
}
