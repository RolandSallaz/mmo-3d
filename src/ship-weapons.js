import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { WEAPON_MODELS } from "../shared/equipment.js";
import { MISSILE_TUBES, WEAPON_BARREL_HEIGHT, WEAPON_BARREL_REACH } from "../shared/ship-geometry.js";

export function createShipWeaponModels() {
  const metal = new MeshStandardMaterial({ color: 0xb1c3d0, metalness: 0.52, roughness: 0.34 });
  const casing = new MeshStandardMaterial({ color: 0x344456, metalness: 0.34, roughness: 0.48 });
  const inset = new MeshStandardMaterial({ color: 0x101a26, roughness: 0.7 });

  const box = (group, material, [width, height, length], [x, y, z]) => {
    const mesh = new Mesh(new BoxGeometry(width, height, length), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  const cylinder = (group, material, radius, start, end, x = 0, y = WEAPON_BARREL_HEIGHT) => {
    const mesh = new Mesh(new CylinderGeometry(radius, radius, end - start, 10), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, -(start + end) / 2);
    group.add(mesh);
  };

  const socket = new Group();
  box(socket, casing, [0.5, 0.14, 0.48], [0, 0.02, 0]);
  box(socket, inset, [0.29, 0.07, 0.39], [0, 0.105, 0]);
  for (const side of [-1, 1]) {
    box(socket, metal, [0.075, 0.07, 0.43], [side * 0.2, 0.115, 0]);
  }

  const weapons = {};
  for (const [id, model] of Object.entries(WEAPON_MODELS)) {
    const turret = new Group();
    const glow = new MeshStandardMaterial({ color: model.color, emissive: model.color, emissiveIntensity: 0.85 });
    const reach = WEAPON_BARREL_REACH[id];
    box(turret, metal, [0.35, 0.19, 0.43], [0, 0.2, 0.025]);
    if (id === "missile") {
      box(turret, casing, [0.56, 0.39, 0.63], [0, 0.34, -0.32]);
      for (const [x, y] of MISSILE_TUBES) {
        cylinder(turret, metal, 0.075, 0.53, reach, x, y);
        cylinder(turret, inset, 0.056, reach - 0.018, reach + 0.003, x, y);
        cylinder(turret, glow, 0.022, reach - 0.02, reach + 0.005, x, y);
      }
      weapons[id] = turret;
      continue;
    }
    if (id === "pulse") {
      box(turret, casing, [0.31, 0.2, 0.36], [0, 0.34, 0.02]);
      box(turret, glow, [0.15, 0.028, 0.23], [0, 0.451, 0.005]);
      cylinder(turret, metal, 0.087, 0.14, reach - 0.13);
    } else {
      box(turret, casing, [0.38, 0.24, 0.41], [0, 0.34, 0]);
      for (const side of [-1, 1]) {
        box(turret, metal, [0.086, 0.12, 0.52], [side * 0.17, 0.34, -0.31]);
        box(turret, glow, [0.044, 0.03, 0.39], [side * 0.17, 0.412, -0.32]);
      }
      cylinder(turret, metal, 0.098, 0.15, reach - 0.13);
    }
    cylinder(turret, casing, 0.125, reach - 0.15, reach - 0.014);
    cylinder(turret, glow, 0.077, reach - 0.08, reach);
    weapons[id] = turret;
  }
  return { socket, weapons };
}
