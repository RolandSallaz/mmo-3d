import {
  DirectionalLight, Group, HemisphereLight, OrthographicCamera, Scene, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import modelUrl from "./spaceship.glb?url";
import pirateUrl from "./pirate-ship.glb?url";

import { CAMERA_ELEVATION_SINE, SHIP_HULL_Y, SHIP_VIEW_SPAN, shipYaw, weaponMount } from "../shared/ship-geometry.js";

import { WEAPON_MOUNTS } from "../shared/equipment.js";
import { createMissileModels } from "./missile-model.js";
import { createEngineEffects } from "./engine-effect.js";
import { createShipWeaponModels } from "./ship-weapons.js";

export async function createShipRenderer(spriteSize) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  if (!context) return null;

  const loader = new GLTFLoader();
  const [civilian, pirate] = await Promise.all([
    loader.loadAsync(modelUrl),
    loader.loadAsync(pirateUrl),
  ]);
  const renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setClearColor(0, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1500);
  camera.position.set(0, 9.87 * 60, 8 * 60);
  camera.lookAt(0, 0, 0);
  scene.add(new HemisphereLight(0xd7e5ff, 0x34415d, 1.8));

  for (const [color, intensity, x, y, z] of [
    [0xe4efff, 2.4, -3, 7, 1],
    [0xffd6b4, 1.0, 4, 3, -3],
    [0x8abfff, 0.65, 0, 3, 5],
  ]) {
    const light = new DirectionalLight(color, intensity);
    light.position.set(x, y, z);
    scene.add(light);
  }

  const units = SHIP_VIEW_SPAN / spriteSize;
  const weaponModels = createShipWeaponModels();
  const engineEffects = createEngineEffects();
  const updateMissiles = createMissileModels(scene, units);
  const instances = [];
  let previousWidth = 0;
  let previousHeight = 0;
  let previousRatio = 0;
  let dirty = true;
  canvas.addEventListener("webglcontextrestored", () => { dirty = true; });

  return (entries, width, height, ratio, time, missiles = []) => {
    if (context.isContextLost()) return null;

    const pixelRatio = Math.min(ratio, 1.5);
    if (width !== previousWidth || height !== previousHeight || pixelRatio !== previousRatio) {
      previousWidth = width;
      previousHeight = height;
      previousRatio = pixelRatio;
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.left = -width * units / 2;
      camera.right = -camera.left;
      camera.top = height * units / 2;
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
      dirty = true;
    }

    while (instances.length < entries.length) {
      const group = new Group();
      const attitude = new Group();
      const hull = new Group();
      const mounts = WEAPON_MOUNTS.map(() => weaponModels.socket.clone());
      const jets = engineEffects.create();
      attitude.add(hull, jets, ...mounts);
      group.add(attitude);
      scene.add(group);
      instances.push({ group, attitude, hull, jets, mounts, idleBlend: 0, poseTime: undefined, mounted: WEAPON_MOUNTS.map(() => ""), source: null });
      dirty = true;
    }

    for (const [index, instance] of instances.entries()) {
      const { group, attitude, hull, jets, mounts, mounted } = instance;
      const entry = entries[index];
      if (group.visible !== Boolean(entry)) {
        group.visible = Boolean(entry);
        dirty = true;
      }
      if (!entry) continue;
      if (engineEffects.update(jets, entry.sprite, time)) dirty = true;
      if (time !== undefined) {
        const idle = jets.visible ? 0 : 1;
        const elapsed = Math.max(0, time - (instance.poseTime ?? time - 16));
        instance.poseTime = time;
        const previous = instance.idleBlend;
        const step = elapsed * 0.005;
        instance.idleBlend += Math.max(-step, Math.min(step, idle - previous));
        const phase = time / 700 + index * 1.83;
        attitude.rotation.z = Math.sin(phase) * 0.063 * instance.idleBlend;
        attitude.rotation.x = Math.sin(phase * 0.76 + 0.6) * 0.031 * instance.idleBlend;
        attitude.position.y = Math.sin(phase * 1.2) * 0.065 * instance.idleBlend;
        if (previous || instance.idleBlend) dirty = true;
      }
      const source = entry.sprite.model === "pirate" ? pirate.scene : civilian.scene;
      if (instance.source !== source) {
        hull.clear();
        const model = source.clone();
        model.position.y = SHIP_HULL_Y;
        hull.add(model);
        for (const [slotIndex, mount] of mounts.entries()) {
          const { x, y, z } = weaponMount(entry.sprite.model, slotIndex);
          mount.position.set(x, y, z);
        }
        instance.source = source;
        dirty = true;
      }
      const equipped = WEAPON_MOUNTS.map(({ field }) => entry.sprite[field]);
      for (const [slotIndex, model] of equipped.entries()) {
        const next = Object.hasOwn(weaponModels.weapons, model) ? model : "";
        const mount = mounts[slotIndex];
        let weapon = mount.getObjectByName("weapon");
        if (mounted[slotIndex] !== next) {
          if (weapon) mount.remove(weapon);
          weapon = next ? weaponModels.weapons[next].clone() : undefined;
          if (weapon) {
            weapon.name = "weapon";
            mount.add(weapon);
          }
          mounted[slotIndex] = next;
          dirty = true;
        }
        const yaw = entry.aim?.[slotIndex]?.yaw ?? 0;
        if (weapon && weapon.rotation.y !== yaw) {
          weapon.rotation.y = yaw;
          dirty = true;
        }
      }
      const x = (entry.x - width / 2) * units;
      const z = (entry.y - height / 2) * units / CAMERA_ELEVATION_SINE;
      const yaw = shipYaw(entry.sprite.heading);
      if (group.position.x !== x || group.position.z !== z || group.rotation.y !== yaw) {
        group.position.set(x, 0, z);
        group.rotation.y = yaw;
        dirty = true;
      }
    }

    if (updateMissiles(missiles, width, height)) dirty = true;

    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    return canvas;
  };
}
