import { engineModel } from "./equipment.js";

export const FLIGHT_TICK_MS = 1000 / 30;

function headingDifference(from, to) {
  const difference = to - from;
  return Math.atan2(Math.sin(difference), Math.cos(difference));
}

export function turnToward(ship, target, seconds) {
  const dx = target.x - ship.x;
  const dy = target.y - ship.y;
  if (!dx && !dy) return;
  const heading = Math.atan2(dx, -dy);
  const turn = headingDifference(ship.heading, heading);
  const limit = engineModel(ship.engineModel).turnSpeed * seconds;
  ship.heading = Math.abs(turn) <= limit ? heading : ship.heading + Math.sign(turn) * limit;
}

export function advanceFlight(ship, destination, seconds, worldSize) {
  const dx = destination.x - ship.x;
  const dy = destination.y - ship.y;
  const distance = Math.hypot(dx, dy);
  const heading = Math.atan2(dx, -dy);
  const turn = headingDifference(ship.heading, heading);
  const engine = engineModel(ship.engineModel);
  const turnLimit = engine.turnSpeed * seconds;
  const steering = Math.max(-turnLimit, Math.min(turnLimit, turn));
  const aligned = Math.abs(turn) <= turnLimit;
  const step = engine.speed * seconds;

  if (distance < 0.08 || (aligned && distance <= step)) {
    if (distance >= 0.08) ship.heading = heading;
    ship.x = destination.x;
    ship.y = destination.y;
    return true;
  }

  const direction = aligned ? heading : ship.heading + steering / 2;
  const advance = aligned
    ? step
    : Math.min(step * (0.38 + 0.62 * Math.cos(turn / 2) ** 2), distance * Math.sin(turnLimit) * 0.45);
  ship.heading = aligned ? heading : ship.heading + steering;
  ship.x = Math.max(0, Math.min(worldSize, ship.x + Math.sin(direction) * advance));
  ship.y = Math.max(0, Math.min(worldSize, ship.y - Math.cos(direction) * advance));
  return false;
}
