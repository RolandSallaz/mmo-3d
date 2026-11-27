export const SHIP_SPRITE_SIZE = 64;
export const SHIP_VIEW_SPAN = 5.25;
export const SHIP_HULL_Y = -0.13;
export const CAMERA_ELEVATION_SINE = 9.87 / Math.hypot(8, 9.87);
const CAMERA_ELEVATION_COSINE = 8 / Math.hypot(8, 9.87);

export function shipYaw(heading) {
  return -Math.atan2(Math.sin(heading), Math.cos(heading) / CAMERA_ELEVATION_SINE);
}

export const WEAPON_BARREL_HEIGHT = 0.34;
export const WEAPON_BARREL_REACH = { pulse: 0.78, ion: 0.91 };

export function weaponMount(shipModel, slotIndex) {
  const side = slotIndex === 0 ? -1 : 1;
  return shipModel === "pirate"
    ? { x: side * 0.96, y: SHIP_HULL_Y + 0.34, z: 0.19 }
    : { x: side * 1.78, y: SHIP_HULL_Y + 0.27, z: 0.78 };
}

export function laserMuzzle(heading, slotIndex, weaponModel) {
  const mount = weaponMount(undefined, slotIndex);
  const x = mount.x;
  const y = mount.y + WEAPON_BARREL_HEIGHT;
  const z = mount.z - WEAPON_BARREL_REACH[weaponModel];
  const yaw = shipYaw(heading);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const scale = SHIP_SPRITE_SIZE / SHIP_VIEW_SPAN;
  return {
    x: (x * cos + z * sin) * scale,
    y: ((z * cos - x * sin) * CAMERA_ELEVATION_SINE - y * CAMERA_ELEVATION_COSINE) * scale,
  };
}
