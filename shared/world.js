export const PLANET_RADIUS = 144;
export const SUN_RADIUS = 350;
export const SUN_HEAT_RADIUS = 465;
export const PLANET_ORBIT_RADIUS = 820;
export const PLANET_ORBIT_MS = 12 * 60_000;

export function sunPosition(worldSize) {
  return { x: worldSize / 2 - 460, y: worldSize / 2 - 130 };
}

export function planetPosition(worldSize, elapsedMs) {
  const sun = sunPosition(worldSize);
  const angle = 2 * Math.PI * (elapsedMs % PLANET_ORBIT_MS) / PLANET_ORBIT_MS;
  return {
    x: sun.x + Math.cos(angle) * PLANET_ORBIT_RADIUS,
    y: sun.y + Math.sin(angle) * PLANET_ORBIT_RADIUS,
  };
}
