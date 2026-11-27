import { Client } from "@colyseus/sdk";
import { engineModel, SHIELD_MODELS } from "../shared/equipment.js";
import { drawShieldShell } from "./shield-effect.js";
import { SHIP_SPRITE_SIZE as SHIP_SIZE, laserMuzzle } from "../shared/ship-geometry.js";
import { drawLaserShots, receiveLaserShots } from "./laser-effect.js";
import { setupInventory } from "./inventory.js";
import { advanceFlight, FLIGHT_TICK_MS } from "../shared/flight.js";
import spaceshipUrl from "./spaceship.webp";
import pirateAtlasUrl from "./pirate-directions.webp";
import { PLANET_RADIUS, planetPosition } from "../shared/world.js";
import shipFrames from "./ship-frames.json";
import planetUrl from "./spawn-planet.webp";
import { createPlanetRenderer } from "./planet.js";

const menu = document.querySelector("#menu");
const nicknameInput = document.querySelector("#nickname");
const button = document.querySelector("#join");
const status = document.querySelector("#status");
const world = document.querySelector("#world");
const objectTooltip = document.querySelector("#object-tooltip");
const objectName = document.querySelector("#object-name");
const objectHealth = document.querySelector("#object-health");
const flightHelp = document.querySelector("#flight-help");
const fullscreenButton = document.querySelector("#fullscreen");
const STAR_TILE_SIZE = 640;
const SHIP_FRAME_SIZE = 112;
const SHIP_FRAME_COLUMNS = 8;
const SHIP_FRAME_STEP = 2 * Math.PI / shipFrames.length;
const SHIP_HIT_RADIUS = 32;

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
}

if (document.fullscreenEnabled) {
  fullscreenButton.hidden = false;
  const requestFullscreenChange = () => toggleFullscreen().catch(console.warn);
  fullscreenButton.addEventListener("click", requestFullscreenChange);
  document.addEventListener("keydown", (event) => {
    if (!world.hidden && !event.repeat && !event.ctrlKey && !event.altKey &&
        !event.metaKey && event.code === "KeyF") requestFullscreenChange();
  });
  document.addEventListener("fullscreenchange", () => {
    const fullscreen = Boolean(document.fullscreenElement);
    fullscreenButton.textContent = fullscreen ? "Выйти из полноэкранного режима" : "На весь экран";
  });
}
const context = world.getContext("2d");
const minimap = document.querySelector("#minimap");
const mapContext = minimap.getContext("2d");
const MAP_RANGE = 2400;
const planet = new Image();
planet.addEventListener("load", () => {
  if (!world.hidden && !frame) frame = requestAnimationFrame(drawWorld);
});
planet.src = planetUrl;
const starLayers = [
  { count: 150, size: 1, speed: 0.13, opacity: 0.48 },
  { count: 50, size: 2, speed: 0.36, opacity: 0.82 },
].map((layer) => {
  const tile = document.createElement("canvas");
  tile.width = STAR_TILE_SIZE;
  tile.height = STAR_TILE_SIZE;

  const stars = tile.getContext("2d");
  for (let i = 0; i < layer.count; i++) {
    const x = Math.floor(Math.random() * (tile.width - layer.size + 1));
    const y = Math.floor(Math.random() * (tile.height - layer.size + 1));
    stars.fillStyle = `rgba(205, 221, 255, ${layer.opacity * (0.35 + Math.random() * 0.65)})`;
    stars.fillRect(x, y, layer.size, layer.size);
  }
  return { pattern: context.createPattern(tile, "repeat"), speed: layer.speed };
});
const ship = new Image();
ship.src = spaceshipUrl;
const pirateAtlas = new Image();
pirateAtlas.src = pirateAtlasUrl;
let activeRoom;
let frame = 0;
let renderPlanet;
let renderShipModels;

import("./ship-model.js")
  .then(({ createShipRenderer }) => createShipRenderer(SHIP_SIZE))
  .then((renderer) => {
    renderShipModels = renderer;
    if (renderer && !world.hidden && !frame) frame = requestAnimationFrame(drawWorld);
  }).catch(console.warn);

createPlanetRenderer().then((renderer) => {
  renderPlanet = renderer;
  if (renderer && !world.hidden && !frame) frame = requestAnimationFrame(drawWorld);
}).catch(console.warn);
const visiblePlayers = new Map();
let localSprite;
let worldSize;
const inventoryPanel = setupInventory(() => {
  stopSteering();
  clearHover();
});
let flightDestination;
const laserEffects = [];
let testShip;
let pirateShip;
let hoverPointer;

new ResizeObserver(() => {
  if (!world.hidden && !frame) frame = requestAnimationFrame(drawWorld);
}).observe(world);

function shipAt(x, y, includeLocal = false) {
  let nearest = SHIP_HIT_RADIUS;
  let target;
  for (const sprite of [testShip, pirateShip, ...visiblePlayers.values()]) {
    if (!sprite?.hp || (!includeLocal && sprite.local)) continue;
    const distance = Math.hypot(sprite.x - x, sprite.y - y);
    if (distance < nearest) {
      nearest = distance;
      target = sprite;
    }
  }
  return target;
}

world.addEventListener("contextmenu", (event) => event.preventDefault());
world.addEventListener("pointerdown", (event) => {
  if (event.button !== 2 || !activeRoom || !localSprite?.hp) return;
  const bounds = world.getBoundingClientRect();
  const target = shipAt(
    localSprite.x + event.clientX - bounds.left - bounds.width / 2,
    localSprite.y + event.clientY - bounds.top - bounds.height / 2,
  );
  if (target) {
    stopSteering();
    flightDestination = undefined;
  }
  activeRoom.send("attack", target?.id ?? "");
});

function setDestination(x, y) {
  flightDestination = {
    x: Math.max(0, Math.min(worldSize, x)),
    y: Math.max(0, Math.min(worldSize, y)),
  };
  activeRoom.send("move", flightDestination);
  if (!frame) frame = requestAnimationFrame(drawWorld);
}

let flightPointer;
let steeringTimer;

function steerTowardPointer() {
  if (!activeRoom || !localSprite?.hp || !flightPointer) return;

  const bounds = world.getBoundingClientRect();
  setDestination(
    localSprite.x + flightPointer.x - bounds.left - bounds.width / 2,
    localSprite.y + flightPointer.y - bounds.top - bounds.height / 2,
  );
}

function stopSteering() {
  clearInterval(steeringTimer);
  flightPointer = undefined;
}

world.addEventListener("pointerdown", (event) => {
  if (!activeRoom || !localSprite?.hp || !event.isPrimary || event.button !== 0 || flightPointer) return;

  flightPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  world.setPointerCapture(event.pointerId);
  steerTowardPointer();
  steeringTimer = setInterval(steerTowardPointer, 65);
});

world.addEventListener("pointermove", (event) => {
  if (event.pointerType === "mouse") {
    hoverPointer = { x: event.clientX, y: event.clientY };
    const nearRight = event.clientX + 200 > world.clientWidth;
    const nearBottom = event.clientY + 92 > world.clientHeight;
    objectTooltip.style.left = `${event.clientX + (nearRight ? -14 : 14)}px`;
    objectTooltip.style.top = `${event.clientY + (nearBottom ? -14 : 14)}px`;
    objectTooltip.style.transform = `translate(${nearRight ? "-100%" : "0"}, ${nearBottom ? "-100%" : "0"})`;
    if (!frame && !world.hidden) frame = requestAnimationFrame(drawWorld);
  }

  if (event.pointerId !== flightPointer?.id) return;
  flightPointer.x = event.clientX;
  flightPointer.y = event.clientY;
});

for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  world.addEventListener(type, (event) => {
    if (event.pointerId === flightPointer?.id) stopSteering();
  });
}
function clearHover() {
  hoverPointer = undefined;
  objectTooltip.hidden = true;
  if (!frame && !world.hidden) frame = requestAnimationFrame(drawWorld);
}

world.addEventListener("pointerleave", clearHover);
window.addEventListener("blur", () => {
  stopSteering();
  clearHover();
});
let mapBounds;

minimap.addEventListener("click", (event) => {
  if (!activeRoom || !localSprite?.hp || !mapBounds || event.button !== 0 || minimap.hidden) return;

  const bounds = minimap.getBoundingClientRect();
  setDestination(
    mapBounds.left + (event.clientX - bounds.left) * mapBounds.range / bounds.width,
    mapBounds.top + (event.clientY - bounds.top) * mapBounds.range / bounds.height,
  );
});

function drawMinimap(viewWidth, viewHeight, planetX, planetY) {
  const size = minimap.width;
  const range = Math.min(MAP_RANGE, worldSize);
  const left = Math.max(0, Math.min(worldSize - range, localSprite.x - range / 2));
  const top = Math.max(0, Math.min(worldSize - range, localSprite.y - range / 2));
  const scale = size / range;
  mapBounds = { left, top, range };

  mapContext.clearRect(0, 0, size, size);
  mapContext.strokeStyle = "#8ea8d466";
  mapContext.strokeRect(
    (localSprite.x - viewWidth / 2 - left) * scale,
    (localSprite.y - viewHeight / 2 - top) * scale,
    viewWidth * scale,
    viewHeight * scale,
  );
  mapContext.fillStyle = "#ad84da";
  mapContext.beginPath();
  mapContext.arc((planetX - left) * scale, (planetY - top) * scale, PLANET_RADIUS * scale, 0, Math.PI * 2);
  mapContext.fill();

  if (testShip?.hp) {
    mapContext.fillStyle = "#ffc07a";
    mapContext.fillRect((testShip.x - left) * scale - 2, (testShip.y - top) * scale - 2, 4, 4);
  }

  if (pirateShip?.hp) {
    mapContext.fillStyle = "#ff7587";
    mapContext.beginPath();
    mapContext.arc((pirateShip.x - left) * scale, (pirateShip.y - top) * scale, 2.5, 0, Math.PI * 2);
    mapContext.fill();
  }

  for (const player of visiblePlayers.values()) {
    if (!player.hp) continue;
    const x = (player.x - left) * scale;
    const y = (player.y - top) * scale;
    mapContext.fillStyle = player.local ? "#7ee8ff" : "#fff";
    mapContext.fillRect(x - 2, y - 2, 4, 4);
  }
}
function pirateNozzles(heading) {
  const elevation = 9.87 / Math.hypot(8, 9.87);
  const yaw = Math.atan2(Math.sin(heading), Math.cos(heading) / elevation);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [-0.67, 0.76].map((x) => [
    (cos * x - 1.99 * sin) / 5.25,
    (elevation * (1.99 * cos + x * sin) + 0.063) / 5.25,
  ]);
}

function drawEngineFlames(time, nozzles, heading, [outer, inner]) {
  for (const [nozzleX, nozzleY] of nozzles) {
    const length = 15 + 4 * Math.sin(time / 32 + nozzleX * SHIP_SIZE);
    context.save();
    context.translate(nozzleX * SHIP_SIZE, nozzleY * SHIP_SIZE);
    context.rotate(heading);

    context.fillStyle = outer;
    context.beginPath();
    context.moveTo(-2.8, 0);
    context.quadraticCurveTo(-4, 7, 0, length);
    context.quadraticCurveTo(4, 7, 2.8, 0);
    context.fill();

    context.fillStyle = inner;
    context.beginPath();
    context.moveTo(-1.6, 0);
    context.quadraticCurveTo(-2.3, 4, 0, length * 0.6);
    context.quadraticCurveTo(2.3, 4, 1.6, 0);
    context.fill();
    context.restore();
  }
}
function interpolateShip(player, time) {
  let turning = false;
  const dx = player.targetX - player.x;
  const dy = player.targetY - player.y;
  if (Math.hypot(dx, dy) > 0.25) {
    player.x += dx * 0.35;
    player.y += dy * 0.35;
    player.thrustUntil = time + 80;
  } else {
    player.x = player.targetX;
    player.y = player.targetY;
  }
  const difference = player.targetHeading - player.heading;
  const turn = Math.atan2(Math.sin(difference), Math.cos(difference));
  if (Math.abs(turn) > 0.006) {
    player.heading += turn * 0.36;
    turning = true;
  } else {
    player.heading = player.targetHeading;
  }

  return turning || time < (player.thrustUntil ?? 0);
}

function drawWorld(time) {
  const width = world.clientWidth;
  const height = world.clientHeight;
  const ratio = Math.min(devicePixelRatio, 2);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (world.width !== pixelWidth || world.height !== pixelHeight) {
    world.width = pixelWidth;
    world.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  let animating = pirateShip ? interpolateShip(pirateShip, time) : false;
  for (const player of visiblePlayers.values()) {
    if (interpolateShip(player, time)) animating = true;
  }
  const centerX = width / 2;
  const centerY = height / 2;
  for (const { pattern, speed } of starLayers) {
    const offsetX = (centerX - localSprite.x * speed) % STAR_TILE_SIZE;
    const offsetY = (centerY - localSprite.y * speed) % STAR_TILE_SIZE;
    pattern.setTransform(new DOMMatrix().translateSelf(offsetX, offsetY));
    context.fillStyle = pattern;
    context.fillRect(0, 0, width, height);
  }

  const { x: planetX, y: planetY } = planetPosition(worldSize);
  const planetLeft = centerX + planetX - localSprite.x - PLANET_RADIUS;
  const planetTop = centerY + planetY - localSprite.y - PLANET_RADIUS;
  const diameter = PLANET_RADIUS * 2;
  let planetVisible = false;
  if (planetLeft < width && planetTop < height &&
      planetLeft + diameter > 0 && planetTop + diameter > 0) {
    const rotatingPlanet = renderPlanet?.(time);
    if (rotatingPlanet || planet.naturalWidth) {
      context.drawImage(rotatingPlanet ?? planet, planetLeft, planetTop, diameter, diameter);
      planetVisible = true;
    }
    if (rotatingPlanet) animating = true;
  }
  drawMinimap(width, height, planetX, planetY);

  drawFlightPath(centerX, centerY);
  context.font = "13px system-ui";
  context.textAlign = "center";
  if (drawShips(time, width, height, ratio)) animating = true;
  const targetId = localSprite.attackTarget;
  const target = targetId === "npc:pirate" ? pirateShip
    : targetId === "npc:test" ? testShip : visiblePlayers.get(targetId);
  if (target?.hp) {
    context.strokeStyle = "#ff7587";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(centerX + target.x - localSprite.x, centerY + target.y - localSprite.y,
      SHIP_HIT_RADIUS + 9, 0, Math.PI * 2);
    context.stroke();
  }
  drawObjectHover(centerX, centerY, planetVisible ? {
    x: planetLeft + PLANET_RADIUS,
    y: planetTop + PLANET_RADIUS,
    radius: PLANET_RADIUS,
    label: "Люмена · Дружелюбная",
  } : null);
  frame = animating ? requestAnimationFrame(drawWorld) : 0;
}

function drawFlightPath(centerX, centerY) {
  if (!flightDestination) return;
  if (Math.hypot(flightDestination.x - localSprite.x, flightDestination.y - localSprite.y) < 1) {
    flightDestination = undefined;
    return;
  }

  const path = { x: localSprite.x, y: localSprite.y, heading: localSprite.heading, engineModel: localSprite.engineModel };
  const originX = centerX - path.x;
  const originY = centerY - path.y;
  context.save();
  context.strokeStyle = "#8ee9ffd9";
  context.lineWidth = 1.5;
  context.lineCap = "round";
  context.setLineDash([2, 7]);
  context.beginPath();
  context.moveTo(centerX, centerY);
  for (let i = 0; i < 360; i++) {
    const arrived = advanceFlight(path, flightDestination, FLIGHT_TICK_MS / 1000, worldSize);
    if (arrived || i % 2 === 0) context.lineTo(originX + path.x, originY + path.y);
    if (arrived) break;
  }
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(originX + flightDestination.x, originY + flightDestination.y, 5, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawObjectHover(centerX, centerY, planetTarget) {
  let target;
  if (hoverPointer) {
    const ship = shipAt(localSprite.x + hoverPointer.x - centerX, localSprite.y + hoverPointer.y - centerY, true);
    if (ship) {
      target = {
        x: centerX + ship.x - localSprite.x,
        y: centerY + ship.y - localSprite.y,
        radius: SHIP_HIT_RADIUS,
        label: ship.hoverLabel ?? ship.nickname,
        ship,
      };
    }

    if (!target && planetTarget &&
        Math.hypot(hoverPointer.x - planetTarget.x, hoverPointer.y - planetTarget.y) <= planetTarget.radius) {
      target = planetTarget;
    }
  }

  objectTooltip.hidden = !target;
  if (!target) return;
  if (objectName.textContent !== target.label) objectName.textContent = target.label;
  objectHealth.hidden = !target.ship;
  if (target.ship) {
    const stats = `Прочность ${target.ship.hp}/${target.ship.maxHp}
Щит ${Math.ceil(target.ship.shield)}/${target.ship.maxShield}`;
    if (objectHealth.textContent !== stats) objectHealth.textContent = stats;
  }

  context.save();
  context.strokeStyle = "#9ee7ff";
  context.lineWidth = 1.5;
  context.shadowColor = "#4ac6ff";
  context.shadowBlur = 8;
  context.beginPath();
  context.arc(target.x, target.y, target.radius + 4, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function copyHull(sprite, ship) {
  sprite.hp = ship.hp;
  sprite.maxHp = ship.maxHp;
  sprite.shield = ship.shield;
  sprite.maxShield = ship.maxShield;
  sprite.shieldModel = ship.shieldModel;
  sprite.weaponLeft = ship.weaponLeft;
  sprite.weaponRight = ship.weaponRight;
}

function drawShips(time, width, height, ratio) {
  const entries = [];
  const addVisibleShip = (sprite) => {
    if (!sprite.hp) return;
    const x = width / 2 + (sprite.x - localSprite.x);
    const y = height / 2 + (sprite.y - localSprite.y);
    if (x >= -64 && y >= -64 && x <= width + 64 && y <= height + 64) {
      entries.push({ sprite, x, y });
    }
  };

  if (testShip) addVisibleShip(testShip);
  if (pirateShip) addVisibleShip(pirateShip);
  for (const player of visiblePlayers.values()) addVisibleShip(player);
  const models = renderShipModels?.(entries, width, height, ratio);

  for (const { sprite, x, y } of entries) {
    const angle = Math.round(sprite.heading / SHIP_FRAME_STEP) % shipFrames.length;
    const index = (angle + shipFrames.length) % shipFrames.length;
    context.save();
    context.translate(x, y);
    if (sprite.model === "pirate") {
      // The exhaust ports sit wider and farther aft than the civilian ship's.
      const heading = models ? sprite.heading : index * SHIP_FRAME_STEP;
      drawEngineFlames(time, pirateNozzles(heading), heading, ["#ff9c32", "#fff0a3"]);
    } else if (time < (sprite.thrustUntil ?? 0)) {
      drawEngineFlames(time, shipFrames[index], models ? sprite.heading : index * SHIP_FRAME_STEP,
        engineModel(sprite.engineModel).exhaust);
    }
    if (!models) {
      const frameX = (index % SHIP_FRAME_COLUMNS) * SHIP_FRAME_SIZE;
      const frameY = Math.floor(index / SHIP_FRAME_COLUMNS) * SHIP_FRAME_SIZE;
      const atlas = sprite.model === "pirate" ? pirateAtlas : ship;
      if (atlas.naturalWidth) context.drawImage(atlas, frameX, frameY, SHIP_FRAME_SIZE, SHIP_FRAME_SIZE,
        -SHIP_SIZE / 2, -SHIP_SIZE / 2, SHIP_SIZE, SHIP_SIZE);
    }
    context.restore();
  }
  if (models) context.drawImage(models, 0, 0, width, height);

  const lasersVisible = drawLaserShots(context, laserEffects, width / 2 - localSprite.x,
    height / 2 - localSprite.y, time, (shot) => {
      const shooter = visiblePlayers.get(shot.shooterId);
      if (!shooter?.hp) return shot;
      const heading = models ? shooter.heading : Math.round(shooter.heading / SHIP_FRAME_STEP) * SHIP_FRAME_STEP;
      const muzzle = laserMuzzle(heading, shot.slotIndex, shot.modelId);
      return { x: shooter.x + muzzle.x, y: shooter.y + muzzle.y };
    });

  let showShield = false;
  for (const { sprite, x, y } of entries) {
    const shield = SHIELD_MODELS[sprite.shieldModel];
    if (!shield || sprite.shield <= 0) continue;
    drawShieldShell(context, shield, x, y, time);
    showShield = true;
  }

  for (const { sprite, x, y } of entries) {
    context.fillStyle = sprite.labelColor ?? (sprite.local ? "#7ee8ff" : "#fff");
    const shield = SHIELD_MODELS[sprite.shieldModel];
    const textY = y + (shield && sprite.shield > 0 ? shield.radius + 15 : 42);
    context.fillText(sprite.nickname, x, textY, 108);
    if (sprite.hp < sprite.maxHp) {
      context.fillStyle = "#0a1224";
      context.fillRect(x - 19, textY + 4, 38, 3);
      context.fillStyle = "#ff7587";
      context.fillRect(x - 19, textY + 4, 38 * sprite.hp / sprite.maxHp, 3);
    }
  }
  return showShield || lasersVisible;
}
window.render_game_to_text = () => JSON.stringify({
  mode: world.hidden ? "menu" : "world",
  coordinates: "Origin at top left, x right, y down",
  worldSize,
  flightDestination,
  testShip,
  pirateShip,
  players: [...visiblePlayers.values()],
});
const endpoint = import.meta.env.VITE_COLYSEUS_URL ||
  (import.meta.env.DEV ? "http://localhost:2567" : "");

const sessionKey = `mmo-session:${endpoint}`;
const pilotKey = `mmo-pilot:${endpoint}`;

function joinCharacter(nickname) {
  const key = `mmo-character:${endpoint}:${nickname.normalize("NFC").toLowerCase()}`;
  let inventoryToken = localStorage.getItem(key);
  if (!inventoryToken) {
    inventoryToken = Array.from(crypto.getRandomValues(new Uint8Array(32)),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, inventoryToken);
  }
  return client.joinOrCreate("world", { nickname, inventoryToken });
}

async function restoreRoom(token) {
  if (!token) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await client.reconnect(token);
    } catch {
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 220));
    }
  }
  return null;
}
const client = endpoint ? new Client(endpoint) : null;

if (!client) {
  button.disabled = true;
  status.textContent = "Адрес игрового сервера пока не настроен.";
}

nicknameInput.addEventListener("input", () => nicknameInput.setCustomValidity(""));

menu.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (button.disabled) return;

  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    nicknameInput.setCustomValidity("Введите ник.");
    nicknameInput.reportValidity();
    return;
  }

  await connect(nickname);
});

async function connect(nickname, reconnectionToken) {
  const restoring = Boolean(reconnectionToken || nickname === sessionStorage.getItem(pilotKey));
  button.disabled = true;
  nicknameInput.disabled = true;
  status.textContent = restoring ? "Восстанавливаем сессию…" : "Подключение…";

  try {
    await ship.decode();
    const restored = await restoreRoom(reconnectionToken);
    const room = restored ?? (nickname && await joinCharacter(nickname));
    if (!room) throw new Error("No character to restore.");
    if (nickname) sessionStorage.setItem(pilotKey, nickname);
    const saveToken = () => sessionStorage.setItem(sessionKey, room.reconnectionToken);
    saveToken();
    room.onReconnect(saveToken);
    room.onMessage("laser:shots", (shots) => {
      if (activeRoom !== room) return;
      receiveLaserShots(laserEffects, shots, performance.now());
      if (!frame && !world.hidden) frame = requestAnimationFrame(drawWorld);
    });
    room.onDrop(() => {
      stopSteering();
      flightDestination = undefined;
    });
    activeRoom = room;
    inventoryPanel.bind(room);
    menu.hidden = true;

    room.onStateChange((state) => {
      const localPlayer = state.players.get(room.sessionId);
      if (!localPlayer) return;
      worldSize = state.size;
      const stationShip = state.testShip;
      testShip = stationShip && {
        id: "npc:test",
        x: stationShip.x,
        y: stationShip.y,
        heading: stationShip.heading,
        nickname: "Тестовый корабль",
        labelColor: "#ffc07a",
      };

      if (testShip) copyHull(testShip, stationShip);

      const pirate = state.pirate;
      if (pirate) {
        pirateShip ??= {
          id: "npc:pirate",
          x: pirate.x, y: pirate.y, heading: pirate.heading,
          nickname: "Ржавый Клык", hoverLabel: "Пират · Ржавый Клык",
          model: "pirate", labelColor: "#ff7587",
        };
        copyHull(pirateShip, pirate);
        pirateShip.targetX = pirate.x;
        pirateShip.targetY = pirate.y;
        pirateShip.targetHeading = pirate.heading;
      }

      for (const id of visiblePlayers.keys()) {
        if (!state.players.get(id)?.online && id !== room.sessionId) visiblePlayers.delete(id);
      }
      for (const [id, player] of state.players) {
        if (!player.online && id !== room.sessionId) continue;
        const sprite = visiblePlayers.get(id) ?? {
          id,
          x: player.x,
          y: player.y,
          heading: player.heading ?? 0,
          nickname: player.nickname,
          local: id === room.sessionId,
        };
        sprite.engineModel = player.engineModel;
        copyHull(sprite, player);
        sprite.targetX = player.x;
        sprite.targetY = player.y;
        sprite.targetHeading = player.heading ?? 0;
        visiblePlayers.set(id, sprite);
        if (sprite.local) {
          sprite.attackTarget = localPlayer.attackTarget;
          localSprite = sprite;
        }
      }
      const hull = `Прочность ${localPlayer.hp}/${localPlayer.maxHp} · Щит ${Math.ceil(localPlayer.shield)}/${localPlayer.maxShield}`;
      const statusText = `${localPlayer.nickname} · ${hull} · Игроков: ${visiblePlayers.size}` +
        (localPlayer.hp ? "" : " · Восстановление…");
      if (status.textContent !== statusText) status.textContent = statusText;
      if (!localPlayer.hp) {
        stopSteering();
        flightDestination = undefined;
      }
      flightHelp.hidden = false;
      inventoryPanel.setPilot(localPlayer.nickname);
      world.hidden = false;
      minimap.hidden = false;
      if (!frame) frame = requestAnimationFrame(drawWorld);
    });
    room.onLeave(() => {
      stopSteering();
      laserEffects.length = 0;
      flightHelp.hidden = true;
      sessionStorage.removeItem(sessionKey);
      status.textContent = "Соединение закрыто.";
      world.hidden = true;
      clearHover();
      minimap.hidden = true;
      mapBounds = undefined;
      activeRoom = undefined;
      inventoryPanel.bind(null);
      cancelAnimationFrame(frame);
      frame = 0;
      visiblePlayers.clear();
      localSprite = undefined;
      flightDestination = undefined;
      testShip = undefined;
      pirateShip = undefined;
      menu.hidden = false;
      nicknameInput.disabled = false;
      button.disabled = false;
    });
  } catch (error) {
    if (restoring) sessionStorage.removeItem(sessionKey);
    else console.error(error);
    status.textContent = restoring
      ? "Сессия завершилась. Введите ник, чтобы начать игру."
      : "Не удалось подключиться. Попробуйте ещё раз.";
    nicknameInput.disabled = false;
    button.disabled = false;
  }
}

const savedToken = client && sessionStorage.getItem(sessionKey);
const savedPilot = client && sessionStorage.getItem(pilotKey);
if (savedToken || savedPilot) void connect(savedPilot, savedToken);
