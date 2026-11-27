import {
  BoxGeometry, ConeGeometry, CylinderGeometry, DynamicDrawUsage, InstancedMesh, MeshStandardMaterial, Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CAMERA_ELEVATION_SINE, shipYaw } from "../shared/ship-geometry.js";

export function createMissileModels(scene, units) {
  const shell = new CylinderGeometry(0.105, 0.105, 0.64, 10).rotateX(Math.PI / 2);
  const nose = new ConeGeometry(0.106, 0.28, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.46);
  const fins = [0, 1, 2, 3].map((index) => new BoxGeometry(0.04, 0.16, 0.19)
    .translate(0, 0.14, 0.22).rotateZ(index * Math.PI / 2));
  const band = new CylinderGeometry(0.109, 0.109, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0, -0.16);
  const exhaust = new ConeGeometry(0.083, 0.28, 10).rotateX(Math.PI / 2).translate(0, 0, 0.46);

  const parts = [
    [mergeGeometries([shell, ...fins]), { color: 0xc6d7da, metalness: 0.45, roughness: 0.36 }],
    [mergeGeometries([nose, band]), { color: 0x426a46, metalness: 0.3, roughness: 0.42 }],
    [exhaust, { color: 0x9fffc2, emissive: 0xa5ffbb, emissiveIntensity: 1.6 }],
  ].map(([geometry, properties]) => {
    const mesh = new InstancedMesh(geometry, new MeshStandardMaterial(properties), 640);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  });
  const transform = new Object3D();
  let previousCount = 0;

  return (missiles, width, height) => {
    const count = Math.min(missiles.length, 640);
    if (!count && !previousCount) return false;
    previousCount = count;
    for (let i = 0; i < count; i++) {
      const { x, y, heading } = missiles[i];
      transform.position.set((x - width / 2) * units, 0.06,
        (y - height / 2) * units / CAMERA_ELEVATION_SINE);
      transform.rotation.y = shipYaw(heading);
      transform.updateMatrix();
      for (const mesh of parts) mesh.setMatrixAt(i, transform.matrix);
    }
    for (const mesh of parts) {
      mesh.count = count;
      if (count) mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  };
}
