import { SUN_HEAT_RADIUS, sunPosition } from "./world.js";
import { advanceFlight } from "./flight.js";

const CLEARANCE = SUN_HEAT_RADIUS + 48;
const FULL_TURN = 2 * Math.PI;
const ARC_STEP = Math.PI / 15;

function closestDistance(start, end, center) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const projection = ((center.x - start.x) * dx + (center.y - start.y) * dy) / (dx * dx + dy * dy || 1);
  const t = Math.max(0, Math.min(1, projection));
  return Math.hypot(start.x + t * dx - center.x, start.y + t * dy - center.y);
}

export function advanceSafeFlight(ship, waypoint, seconds, worldSize) {
  const start = { x: ship.x, y: ship.y };
  const sun = sunPosition(worldSize);
  const distance = Math.hypot(start.x - sun.x, start.y - sun.y);
  const arrived = advanceFlight(ship, waypoint, seconds, worldSize);
  const limit = Math.min(distance, SUN_HEAT_RADIUS);
  if (closestDistance(start, ship, sun) >= limit - 1e-6) return arrived;
  Object.assign(ship, start);
  return false;
}

export function planFlight(start, destination, worldSize, direct = false) {
  if (direct) return [destination];
  const sun = sunPosition(worldSize);
  const startDistance = Math.hypot(start.x - sun.x, start.y - sun.y);
  const endDistance = Math.hypot(destination.x - sun.x, destination.y - sun.y);
  if (endDistance >= CLEARANCE && closestDistance(start, destination, sun) >= CLEARANCE) return [destination];

  const startAngle = Math.atan2(start.y - sun.y, start.x - sun.x);
  const endAngle = endDistance ? Math.atan2(destination.y - sun.y, destination.x - sun.x) : startAngle;
  const pointAt = (angle) => ({
    x: sun.x + CLEARANCE * Math.cos(angle),
    y: sun.y + CLEARANCE * Math.sin(angle),
  });
  const startOffset = Math.acos(CLEARANCE / Math.max(CLEARANCE, startDistance));
  const endOffset = Math.acos(CLEARANCE / Math.max(CLEARANCE, endDistance));
  const cw = (endAngle - endOffset - startAngle - startOffset + 2 * FULL_TURN) % FULL_TURN;
  const ccw = (startAngle - startOffset - endAngle - endOffset + 2 * FULL_TURN) % FULL_TURN;
  const direction = cw <= ccw + 1e-6 ? 1 : -1;
  const length = Math.min(cw, ccw);
  const tangent = startAngle + direction * startOffset;
  const steps = Math.max(1, Math.ceil(length / ARC_STEP));
  const route = [];
  for (let i = 0; i <= steps; i++) {
    const point = pointAt(tangent + direction * length * i / steps);
    const previous = route.at(-1) ?? start;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) > 0.08) route.push(point);
  }
  if (endDistance > CLEARANCE || !route.length) route.push(endDistance >= CLEARANCE ? destination : pointAt(endAngle));
  return route;
}
