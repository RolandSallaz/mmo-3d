export const SHIP_SPRITE_SIZE = 64;
export const SHIP_VIEW_SPAN = 5.25;
export const SHIP_HULL_Y = -0.13;
export const CAMERA_ELEVATION_SINE = 9.87 / Math.hypot(8, 9.87);
const CAMERA_ELEVATION_COSINE = 8 / Math.hypot(8, 9.87);

export function shipYaw(heading) {
  return -Math.atan2(Math.sin(heading), Math.cos(heading) / CAMERA_ELEVATION_SINE);
}

export const WEAPON_BARREL_HEIGHT = 0.34;
export const WEAPON_BARREL_REACH = { pulse: 0.78, ion: 0.91, missile: 0.84 };
export const MISSILE_TUBES = [[-0.18, 0.27], [-0.09, 0.43], [0, 0.27], [0.09, 0.43], [0.18, 0.27]];

export function weaponMount(shipModel, slotIndex) {
  if (slotIndex === 2) return { x: 0, y: SHIP_HULL_Y - 0.57, z: -1.65 };
  const side = slotIndex === 0 ? -1 : 1;
  return shipModel === "pirate"
    ? { x: side * 0.96, y: SHIP_HULL_Y + 0.34, z: 0.19 }
    : { x: side * 1.78, y: SHIP_HULL_Y + 0.27, z: 0.78 };
}

function projectWeaponPoint(x, y, z, yaw) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const scale = SHIP_SPRITE_SIZE / SHIP_VIEW_SPAN;
  return {
    x: (x * cos + z * sin) * scale,
    y: ((z * cos - x * sin) * CAMERA_ELEVATION_SINE - y * CAMERA_ELEVATION_COSINE) * scale,
  };
}

export function missileMuzzle(heading, slotIndex, tube) {
  const mount = weaponMount(undefined, slotIndex);
  const [x, y] = tube;
  return projectWeaponPoint(mount.x + x, mount.y + y,
    mount.z - WEAPON_BARREL_REACH.missile, shipYaw(heading));
}

export function laserAim(heading, slotIndex, weaponModel, targetX, targetY, shipModel) {
  const mount = weaponMount(shipModel, slotIndex);
  const hullYaw = shipYaw(heading);
  const height = mount.y + WEAPON_BARREL_HEIGHT;
  const base = projectWeaponPoint(mount.x, height, mount.z, hullYaw);
  const dx = targetX - base.x;
  const dy = targetY - base.y;
  const hasTarget = targetX !== undefined && targetY !== undefined;
  const yaw = hasTarget && (dx || dy) ? shipYaw(Math.atan2(dx, -dy)) - hullYaw : 0;
  const reach = WEAPON_BARREL_REACH[weaponModel];
  const muzzle = projectWeaponPoint(mount.x - reach * Math.sin(yaw), height,
    mount.z - reach * Math.cos(yaw), hullYaw);
  return { yaw, base, muzzle };
}
