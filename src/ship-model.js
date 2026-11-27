import {
  DirectionalLight, Group, HemisphereLight, OrthographicCamera, Scene, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import modelUrl from "./spaceship.glb?url";
import pirateUrl from "./pirate-ship.glb?url";

const CAMERA_ELEVATION_SINE = 9.87 / Math.hypot(8, 9.87);

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

  const units = 5.25 / spriteSize;
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
      scene.add(group);
      instances.push(group);
      dirty = true;
    }

    for (const [index, group] of instances.entries()) {
      const entry = entries[index];
      if (group.visible !== Boolean(entry)) {
        group.visible = Boolean(entry);
        dirty = true;
      }
      if (!entry) continue;
      const source = entry.sprite.model === "pirate" ? pirate.scene : civilian.scene;
      if (group.userData.source !== source) {
        group.clear();
        const hull = source.clone();
        hull.position.y = -0.13;
        group.add(hull);
        group.userData.source = source;
        dirty = true;
      }
      const x = (entry.x - width / 2) * units;
      const z = (entry.y - height / 2) * units / CAMERA_ELEVATION_SINE;
      const yaw = -Math.atan2(Math.sin(entry.sprite.heading), Math.cos(entry.sprite.heading) / CAMERA_ELEVATION_SINE);
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
