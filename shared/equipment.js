export const ENGINE_MODELS = {
  engine: {
    name: "Вектор ИД‑1",
    icon: "engine",
    speed: 180,
    turnSpeed: 3.8,
    exhaust: ["#ff7528", "#fff0a3"],
  },
};

export const SHIELD_MODELS = {
  shield: {
    name: "Аурион СФ‑7",
    icon: "shield",
    radius: 42,
    capacity: 65,
    color: "91, 211, 255",
    shimmerHues: [185, 274],
  },
};

const MANEUVERING_THRUSTERS = {
  speed: 90,
  turnSpeed: 2.6,
  exhaust: ["#5dbcff", "#d9f4ff"],
};

export function engineModel(id) {
  return Object.hasOwn(ENGINE_MODELS, id) ? ENGINE_MODELS[id] : MANEUVERING_THRUSTERS;
}

export const LASER_MODELS = {
  pulse: {
    name: "Луч ЛП‑2",
    icon: "pulse",
    range: 430,
    damage: 18,
    cooldown: 390,
    color: "#ffad45",
    lifetime: 190,
  },
  ion: {
    name: "Призма ЛС‑4",
    icon: "ion",
    range: 545,
    damage: 28,
    cooldown: 650,
    color: "#bc84ff",
    lifetime: 245,
  },
};
