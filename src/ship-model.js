import {
  DirectionalLight, Group, HemisphereLight, OrthographicCamera, Scene, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import modelUrl from "./spaceship.glb?url";
import pirateUrl from "./pirate-ship.glb?url";

import { CAMERA_ELEVATION_SINE, SHIP_HULL_Y, SHIP_VIEW_SPAN, shipYaw, weaponMount } from "../shared/ship-geometry.js";

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
  const instances = [];
  let previousWidth = 0;
  let previousHeight = 0;
  let previousRatio = 0;
  let dirty = true;
  canvas.addEventListener("webglcontextrestored", () => { dirty = true; });

  return (entries, width, height, ratio) => {
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
      const hull = new Group();
      const mounts = [weaponModels.socket.clone(), weaponModels.socket.clone()];
      group.add(hull, ...mounts);
      scene.add(group);
      instances.push({ group, hull, mounts, mounted: ["", ""], source: null });
      dirty = true;
    }

    for (const [index, instance] of instances.entries()) {
      const { group, hull, mounts, mounted } = instance;
      const entry = entries[index];
      if (group.visible !== Boolean(entry)) {
        group.visible = Boolean(entry);
        dirty = true;
      }
      if (!entry) continue;
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
      const equipped = [entry.sprite.weaponLeft, entry.sprite.weaponRight];
      for (const [slotIndex, model] of equipped.entries()) {
        const next = Object.hasOwn(weaponModels.weapons, model) ? model : "";
        if (mounted[slotIndex] === next) continue;
        const mount = mounts[slotIndex];
        if (mounted[slotIndex]) mount.remove(mount.getObjectByName("weapon"));
        if (next) {
          const weapon = weaponModels.weapons[next].clone();
          weapon.name = "weapon";
          mount.add(weapon);
        }
        mounted[slotIndex] = next;
        dirty = true;
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

    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    return canvas;
  };
}
