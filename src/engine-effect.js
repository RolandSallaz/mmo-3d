import {
  AdditiveBlending, Color, Group, LatheGeometry, Mesh, ShaderMaterial, Vector2,
} from "three";
import { engineModel } from "../shared/equipment.js";
import { SHIP_HULL_Y } from "../shared/ship-geometry.js";

export function createEngineEffects() {
  const geometry = new LatheGeometry([
    [0.045, 0], [0.165, 0.13], [0.152, 0.32], [0.12, 0.57], [0.055, 0.83], [0, 1],
  ].map(([radius, length]) => new Vector2(radius, length)), 12);
  const materials = new Map();
  const clock = { value: 0 };

  function materialFor(model) {
    if (materials.has(model)) return materials.get(model);
    const [outer, inner] = model === "pirate" ? ["#ff902c", "#ffedac"] : engineModel(model).exhaust;
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { outer: { value: new Color(outer) }, inner: { value: new Color(inner) }, time: clock },
      vertexShader: `
        varying vec2 flame;
        varying float rim;
        void main() {
          flame = uv;
          rim = abs(dot(normalize(normalMatrix * normal), vec3(0., 0., 1.)));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }
      `,
      fragmentShader: `
        uniform vec3 outer;
        uniform vec3 inner;
        uniform float time;
        varying vec2 flame;
        varying float rim;
        void main() {
          float bands = sin(flame.y * 35.0 - time * 40.0 + flame.x * 13.0);
          float heat = (1. - smoothstep(0.0, 0.58, flame.y)) * (0.65 + 0.35 * rim);
          float alpha = (1. - pow(flame.y, 1.35)) * (0.48 + 0.45 * rim) * (0.88 + 0.12 * bands);
          gl_FragColor = vec4(mix(outer, inner, heat), alpha);
          #include <colorspace_fragment>
        }
      `,
    });
    materials.set(model, material);
    return material;
  }

  function create() {
    const group = new Group();
    for (let i = 0; i < 2; i++) {
      const mesh = new Mesh(geometry, materialFor(""));
      mesh.rotation.x = Math.PI / 2;
      group.add(mesh);
    }
    group.visible = false;
    return group;
  }

  function update(jets, sprite, time) {
    const pirate = sprite.model === "pirate";
    const visible = time !== undefined && (pirate || time < (sprite.thrustUntil ?? 0));
    const changed = jets.visible !== visible;
    jets.visible = visible;
    if (!visible) return changed;

    clock.value = time / 1000;
    const material = materialFor(pirate ? "pirate" : sprite.engineModel ?? "");
    jets.children.forEach((jet, index) => {
      jet.position.set(pirate ? [-0.67, 0.76][index] : [-0.69, 0.69][index],
        SHIP_HULL_Y + (pirate ? 0.03 : 0.06), pirate ? 1.99 : 1.75);
      jet.scale.y = 1.3 + 0.27 * Math.sin(time / 34 + index * 2.3) +
        0.12 * Math.sin(time / 13 + index);
      jet.material = material;
    });
    return true;
  }

  return { create, update };
}
