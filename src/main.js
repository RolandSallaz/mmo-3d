import { Client } from "@colyseus/sdk";
import { engineModel, LASER_MODELS, MISSILE_MODEL, SHIELD_MODELS, WEAPON_MODELS, WEAPON_MOUNTS } from "../shared/equipment.js";
import { drawShieldShell } from "./shield-effect.js";
import { SHIP_SPRITE_SIZE as SHIP_SIZE, laserAim } from "../shared/ship-geometry.js";
import { drawLaserShots, receiveLaserShots } from "./laser-effect.js";
import { drawMissiles, interpolateMissiles, syncMissiles } from "./missile-effect.js";
import { setupInventory } from "./inventory.js";
import { setupPlanetMarket } from "./planet-market.js";
import { addDamageNumber, drawDamageNumbers } from "./damage-numbers.js";
import { createGameAudio } from "./game-audio.js";
import { advanceFlight, FLIGHT_TICK_MS } from "../shared/flight.js";
import spaceshipUrl from "./spaceship.webp";
import pirateAtlasUrl from "./pirate-directions.webp";
import { PLANET_ORBIT_RADIUS, PLANET_RADIUS, SUN_HEAT_RADIUS, SUN_RADIUS, planetPosition, sunPosition } from "../shared/world.js";
import { SUN_GLOW_SCALE, createSunRenderer } from "./sun.js";
import shipFrames from "./ship-frames.json";
import planetUrl from "./spawn-planet.webp";
import { createPlanetRenderer } from "./planet.js";

const menu = document.querySelector("#menu");
const nicknameInput = document.querySelector("#nickname");
const button = document.querySelector("#join");
const status = document.querySelector("#status");
const world = document.querySelector("#world");
const landingTransition = document.querySelector("#landing-transition");
const planetSurface = document.querySelector("#planet-surface");
const launchButton = document.querySelector("#planet-launch");
const objectTooltip = document.querySelector("#object-tooltip");
const objectName = document.querySelector("#object-name");
const objectHealth = document.querySelector("#object-health");
const flightHelp = document.querySelector("#flight-help");
const targetStatus = document.querySelector("#target-status");
const fullscreenButton = document.querySelector("#fullscreen");
const audioButton = document.querySelector("#sound-toggle");
const gameAudio = createGameAudio(audioButton);
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
let orbitSeconds = 0;
let orbitSampleAt = 0;
let renderSun;

function currentPlanet(time) {
  return planetPosition(worldSize, orbitSeconds * 1000 + Math.max(0, time - orbitSampleAt));
}
const market = setupPlanetMarket(() => activeRoom?.send("inventory:get"));
const inventoryPanel = setupInventory(() => {
  stopSteering();
  clearHover();
}, market.update, market.showError);
let flightRoute = [];
let solarHitAt = -Infinity;
const damageNumbers = [];
const laserEffects = [];
const missileSprites = new Map();
const missileImpacts = [];
let testShip;
let pirateShip;
let hoverPointer;
let selectionId;
let cameraZoom = 1;

new ResizeObserver(() => {
  if (!world.hidden && !frame) frame = requestAnimationFrame(drawWorld);
}).observe(world);

function shipAt(x, y) {
  let nearest = SHIP_HIT_RADIUS;
  let target;
  for (const sprite of [testShip, pirateShip, ...visiblePlayers.values()]) {
    if (!sprite?.hp) continue;
    const distance = Math.hypot(sprite.x - x, sprite.y - y);
    if (distance < nearest) {
      nearest = distance;
      target = sprite;
    }
  }
  for (const missile of missileSprites.values()) {
    const distance = Math.hypot(missile.x - x, missile.y - y);
    if (distance < Math.min(nearest, 10)) {
      nearest = distance;
      target = missile;
    }
  }
  return target;
}

function celestialTargets(time) {
  return [
    { ...currentPlanet(time), id: "planet", radius: PLANET_RADIUS, label: "Люмена · Дружелюбная" },
    { ...sunPosition(worldSize), id: "sun", radius: SUN_RADIUS, label: "Веспар", description: "Опасная зона · тепловой урон" },
  ];
}

function targetAt(x, y, bodies) {
  const ship = shipAt(x, y);
  return ship ? shipTarget(ship) : bodies.find((body) => Math.hypot(x - body.x, y - body.y) <= body.radius);
}

function shipTarget(ship) {
  return {
    id: ship.id, x: ship.x, y: ship.y, ship,
    radius: ship.missile ? 10 : SHIP_HIT_RADIUS,
    label: ship.hoverLabel ?? ship.nickname,
  };
}

function selectedTarget(bodies) {
  if (!selectionId) return;
  const body = bodies.find(({ id }) => id === selectionId);
  if (body) return body;
  const selected = combatEntity(selectionId);
  if (selected?.hp) return shipTarget(selected);
}

function combatEntity(id) {
  return id === "npc:pirate" ? pirateShip
    : id === "npc:test" ? testShip
    : id?.startsWith("missile:") ? missileSprites.get(id.slice(8))
    : visiblePlayers.get(id);
}

function isCombatTarget(target) {
  return Boolean(target?.ship && !target.ship.local && target.ship.owner !== activeRoom?.sessionId);
}

function showPlanetPhase(phase) {
  const landed = phase === "landed";
  const landing = phase === "landing";
  const opening = landed && planetSurface.hidden;
  const closing = !landed && !planetSurface.hidden;
  landingTransition.hidden = !landing;
  planetSurface.hidden = !landed;
  world.hidden = landed;
  world.classList.toggle("landing-zoom", landing);
  minimap.hidden = landing || landed;
  flightHelp.hidden = landing || landed;
  if (landing || landed) {
    stopSteering();
    clearHover();
    targetStatus.hidden = true;
  }
  if (landed) {
    cancelAnimationFrame(frame);
    frame = 0;
    gameAudio.setThrust(false);
  }
  if (opening) {
    launchButton.disabled = false;
    launchButton.focus();
  }
  if (closing) {
    market.close();
    if (document.activeElement === launchButton) launchButton.blur();
  }
}

launchButton.addEventListener("click", () => {
  if (localSprite?.landing !== "landed") return;
  launchButton.disabled = true;
  activeRoom?.send("planet:launch");
});

function selectTarget(id) {
  if (selectionId === id) return;
  if (selectionId) activeRoom?.send("attack", "");
  selectionId = id;
  if (id) gameAudio.play("select");
  if (!frame && !world.hidden) frame = requestAnimationFrame(drawWorld);
}

function viewToWorld(pointer) {
  const bounds = world.getBoundingClientRect();
  return {
    x: localSprite.x + (pointer.x - bounds.left - bounds.width / 2) / cameraZoom,
    y: localSprite.y + (pointer.y - bounds.top - bounds.height / 2) / cameraZoom,
  };
}

world.addEventListener("contextmenu", (event) => event.preventDefault());
world.addEventListener("wheel", (event) => {
  if (!activeRoom || !localSprite || world.hidden || localSprite.landing === "landing") return;
  event.preventDefault();
  const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? world.clientHeight : 1;
  cameraZoom = Math.max(0.55, Math.min(1.85, cameraZoom * Math.exp(-event.deltaY * units * 0.0014)));
  if (!frame) frame = requestAnimationFrame(drawWorld);
}, { passive: false });

document.addEventListener("keydown", (event) => {
  if (!activeRoom || world.hidden || !localSprite?.hp || localSprite.landing || event.defaultPrevented || event.repeat ||
      event.ctrlKey || event.altKey || event.metaKey || document.querySelector("dialog[open]") ||
      event.target.closest?.("input, textarea, select, button, [contenteditable]")) return;
  if (event.code === "Escape" && selectionId) {
    selectTarget(undefined);
    return;
  }
  if (event.code !== "Space") return;
  event.preventDefault();
  const target = selectedTarget(celestialTargets(performance.now()));
  if (isCombatTarget(target)) {
    activeRoom.send("attack", target.id);
  }
});

function setDestination(x, y, direct = false) {
  activeRoom.send("move", {
    x: Math.max(0, Math.min(worldSize, x)),
    y: Math.max(0, Math.min(worldSize, y)),
    direct,
  });
}

let flightPointer;
let steeringTimer;

function steerTowardPointer() {
  if (!activeRoom || !localSprite?.hp || !flightPointer) return;

  const point = viewToWorld(flightPointer);
  setDestination(point.x, point.y, flightPointer.direct);
}

function stopSteering() {
  clearInterval(steeringTimer);
  flightPointer = undefined;
}

world.addEventListener("pointerdown", (event) => {
  if (!activeRoom || !localSprite?.hp || !event.isPrimary || event.button !== 0 || flightPointer) return;
  if (localSprite.landing === "landing" || localSprite.landing === "landed") return;
  const point = viewToWorld({ x: event.clientX, y: event.clientY });
  const target = targetAt(point.x, point.y, celestialTargets(performance.now()));
  if (target && !event.shiftKey) {
    selectTarget(target.id);
    if (target.id === "planet") activeRoom.send("planet:land");
    return;
  }

  flightPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, direct: event.shiftKey };
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
for (const type of ["pointerdown", "keydown"]) {
  document.addEventListener(type, (event) => {
    if (event.isTrusted && activeRoom && !world.hidden) gameAudio.unlock();
  }, { capture: true });
}
let mapBounds;
let lastMapDraw = -Infinity;
let mapZoom;
let mapMissileRange;

minimap.addEventListener("click", (event) => {
  if (!activeRoom || !localSprite?.hp || !mapBounds || event.button !== 0 || minimap.hidden) return;

  const bounds = minimap.getBoundingClientRect();
  setDestination(
    mapBounds.left + (event.clientX - bounds.left) * mapBounds.range / bounds.width,
    mapBounds.top + (event.clientY - bounds.top) * mapBounds.range / bounds.height,
    event.shiftKey,
  );
});

function drawMinimap(viewWidth, viewHeight, planetX, planetY, sun, missileRange, time) {
  if (mapBounds && mapZoom === cameraZoom && mapMissileRange === missileRange && time - lastMapDraw < 33) return;
  lastMapDraw = time;
  mapZoom = cameraZoom;
  mapMissileRange = missileRange;
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
  const sunX = (sun.x - left) * scale;
  const sunY = (sun.y - top) * scale;
  mapContext.strokeStyle = "#ffc48455";
  mapContext.beginPath();
  mapContext.arc(sunX, sunY, PLANET_ORBIT_RADIUS * scale, 0, Math.PI * 2);
  mapContext.stroke();
  mapContext.strokeStyle = "#ff875bc0";
  mapContext.beginPath();
  mapContext.arc(sunX, sunY, SUN_HEAT_RADIUS * scale, 0, Math.PI * 2);
  mapContext.stroke();
  mapContext.fillStyle = "#ffad4b";
  mapContext.beginPath();
  mapContext.arc(sunX, sunY, SUN_RADIUS * scale, 0, Math.PI * 2);
  mapContext.fill();
  mapContext.fillStyle = "#ad84da";
  mapContext.beginPath();
  mapContext.arc((planetX - left) * scale, (planetY - top) * scale, PLANET_RADIUS * scale, 0, Math.PI * 2);
  mapContext.fill();

  if (missileRange) {
    mapContext.save();
    mapContext.strokeStyle = MISSILE_MODEL.color;
    mapContext.setLineDash([3, 3]);
    mapContext.beginPath();
    mapContext.arc((localSprite.x - left) * scale, (localSprite.y - top) * scale, missileRange * scale, 0, Math.PI * 2);
    mapContext.stroke();
    mapContext.restore();
  }

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
  const width = world.clientWidth / cameraZoom;
  const height = world.clientHeight / cameraZoom;
  const deviceRatio = Math.min(devicePixelRatio, 1.5);
  const ratio = deviceRatio * cameraZoom;
  const pixelWidth = Math.round(world.clientWidth * deviceRatio);
  const pixelHeight = Math.round(world.clientHeight * deviceRatio);
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
  gameAudio.setThrust(Boolean(localSprite.hp && time < (localSprite.thrustUntil ?? 0)));
  const centerX = width / 2;
  const centerY = height / 2;
  for (const { pattern, speed } of starLayers) {
    const offsetX = (centerX - localSprite.x * speed) % STAR_TILE_SIZE;
    const offsetY = (centerY - localSprite.y * speed) % STAR_TILE_SIZE;
    pattern.setTransform(new DOMMatrix().translateSelf(offsetX, offsetY));
    context.fillStyle = pattern;
    context.fillRect(0, 0, width, height);
  }

  const bodies = celestialTargets(time);
  const [planetTarget, sun] = bodies;
  const sunX = centerX + sun.x - localSprite.x;
  const sunY = centerY + sun.y - localSprite.y;
  const glowRadius = SUN_RADIUS * SUN_GLOW_SCALE;
  const sunVisible = sunX + glowRadius > 0 && sunX - glowRadius < width &&
    sunY + glowRadius > 0 && sunY - glowRadius < height;
  if (sunVisible) {
    renderSun ??= createSunRenderer();
    renderSun(context, sunX, sunY, SUN_RADIUS, time);
    animating = true;
  }

  const { x: planetX, y: planetY } = planetTarget;
  const planetLeft = centerX + planetX - localSprite.x - PLANET_RADIUS;
  const planetTop = centerY + planetY - localSprite.y - PLANET_RADIUS;
  const diameter = PLANET_RADIUS * 2;
  if (planetLeft < width && planetTop < height &&
      planetLeft + diameter > 0 && planetTop + diameter > 0) {
    const rotatingPlanet = renderPlanet?.(time, (sun.x - planetX) / PLANET_ORBIT_RADIUS,
      (planetY - sun.y) / PLANET_ORBIT_RADIUS);
    if (rotatingPlanet || planet.naturalWidth) {
      context.drawImage(rotatingPlanet ?? planet, planetLeft, planetTop, diameter, diameter);
      animating = true;
    }
  }
  const target = localSprite.landing === "landing" ? undefined : selectedTarget(bodies);
  const showRanges = isCombatTarget(target);
  const missileRange = showRanges && !target.ship.missile &&
    WEAPON_MOUNTS.some(({ field }) => localSprite[field] === "missile") ? MISSILE_MODEL.range : 0;
  drawMinimap(width, height, planetX, planetY, sun, missileRange, time);
  if (showRanges) drawWeaponRanges(centerX, centerY, missileRange);
  drawFlightPath(centerX, centerY);
  context.font = "13px system-ui";
  context.textAlign = "center";
  if (drawShips(time, width, height, ratio)) animating = true;
  if (!target) selectionId = undefined;
  targetStatus.hidden = !target;
  if (target) {
    const attacking = localSprite.attackTarget === target.id;
    const label = `${attacking ? "Атака" : "Цель"} · ${target.label}`;
    if (targetStatus.textContent !== label) targetStatus.textContent = label;
    if (!target.description) drawSelection(target, centerX, centerY, attacking);
  }
  drawObjectHover(centerX, centerY, bodies);
  if (drawSolarHeat(time, width, height, sun)) animating = true;
  if (drawDamageNumbers(context, damageNumbers, centerX - localSprite.x, centerY - localSprite.y,
    width, height, time)) animating = true;
  frame = animating ? requestAnimationFrame(drawWorld) : 0;
}

function drawWeaponRanges(centerX, centerY, missileRange) {
  const drawn = new Set();
  const edge = Math.hypot(centerX, centerY);
  context.save();
  context.globalAlpha = 0.64;
  context.lineWidth = 1.5 / cameraZoom;
  context.setLineDash([8 / cameraZoom, 7 / cameraZoom]);
  for (const { field } of WEAPON_MOUNTS) {
    const weapon = WEAPON_MODELS[localSprite[field]];
    if (weapon === MISSILE_MODEL && !missileRange) continue;
    if (!weapon || weapon.range > edge || drawn.has(weapon.range)) continue;
    drawn.add(weapon.range);
    context.strokeStyle = weapon.color;
    context.beginPath();
    context.arc(centerX, centerY, weapon.range, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function drawSelection(target, centerX, centerY, attacking) {
  context.strokeStyle = attacking ? "#ff7587" : "#7fe7ff";
  context.lineWidth = 2 / cameraZoom;
  context.beginPath();
  context.arc(centerX + target.x - localSprite.x, centerY + target.y - localSprite.y,
    target.radius + (target.ship?.missile ? 3 : 9), 0, Math.PI * 2);
  context.stroke();
}

function drawSolarHeat(time, width, height, sun) {
  const distance = Math.hypot(localSprite.x - sun.x, localSprite.y - sun.y);
  const depth = localSprite.hp ? Math.max(0, 1 - distance / SUN_HEAT_RADIUS) : 0;
  const flash = Math.max(0, 1 - (time - solarHitAt) / 340) ** 2;
  if (!depth && !flash) return false;

  const x = width / 2;
  const y = height / 2;
  const glow = context.createRadialGradient(x, y, Math.min(x, y) * 0.35, x, y, Math.hypot(x, y));
  glow.addColorStop(0, "#f44d0d00");
  glow.addColorStop(0.57, "#f44d0d20");
  glow.addColorStop(1, "#ff4e10dc");
  context.save();
  context.globalAlpha = (depth ? 0.22 + depth * 0.21 : 0) + flash * 0.55;
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  context.restore();
  return true;
}

function drawFlightPath(centerX, centerY) {
  const waypoint = flightRoute[0];
  if (!waypoint) return;
  const destination = flightRoute.at(-1);

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
  for (let i = 0; i < 60; i++) {
    const arrived = advanceFlight(path, waypoint, FLIGHT_TICK_MS / 1000, worldSize);
    if (arrived || i % 2 === 0) context.lineTo(originX + path.x, originY + path.y);
    if (arrived) break;
  }
  for (const point of flightRoute) context.lineTo(originX + point.x, originY + point.y);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(originX + destination.x, originY + destination.y, 5, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawObjectHover(centerX, centerY, bodies) {
  let target;
  if (hoverPointer) {
    const point = viewToWorld(hoverPointer);
    target = targetAt(point.x, point.y, bodies);
  }

  objectTooltip.hidden = !target;
  if (!target) return;
  if (objectName.textContent !== target.label) objectName.textContent = target.label;
  objectHealth.hidden = !target.ship && !target.description;
  if (target.description) objectHealth.textContent = target.description;
  if (target.ship) {
    const stats = target.ship.missile ? `Прочность ${target.ship.hp}/${MISSILE_MODEL.missileHp}` : `Прочность ${target.ship.hp}/${target.ship.maxHp}
Щит ${Math.ceil(target.ship.shield)}/${target.ship.maxShield}`;
    if (objectHealth.textContent !== stats) objectHealth.textContent = stats;
  }
  if (target.description || target.id === selectionId) return;

  context.save();
  context.strokeStyle = "#9ee7ff";
  context.lineWidth = 1.5;
  context.shadowColor = "#4ac6ff";
  context.shadowBlur = 8;
  context.beginPath();
  context.arc(centerX + target.x - localSprite.x, centerY + target.y - localSprite.y, target.radius + 4, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function copyHull(sprite, ship) {
  sprite.hp = ship.hp;
  sprite.maxHp = ship.maxHp;
  sprite.shield = ship.shield;
  sprite.maxShield = ship.maxShield;
  sprite.shieldModel = ship.shieldModel;
  for (const { field } of WEAPON_MOUNTS) sprite[field] = ship[field];
}

function drawShips(time, width, height, ratio) {
  const entries = [];
  const firingAt = new Map();
  for (const shot of laserEffects) {
    if (time - shot.time < 120) firingAt.set(shot.shooterId, { x: shot.targetX, y: shot.targetY });
  }
  const addVisibleShip = (sprite) => {
    if (!sprite.hp) return;
    const x = width / 2 + (sprite.x - localSprite.x);
    const y = height / 2 + (sprite.y - localSprite.y);
    if (x >= -64 && y >= -64 && x <= width + 64 && y <= height + 64) {
      const target = firingAt.get(sprite.id) ?? combatEntity(sprite.attackTarget);
      const aim = WEAPON_MOUNTS.map(({ field }, slot) => (
        Object.hasOwn(LASER_MODELS, sprite[field])
          ? laserAim(sprite.heading, slot, sprite[field], target && target.x - sprite.x,
            target && target.y - sprite.y, sprite.model)
          : undefined
      ));
      entries.push({ sprite, x, y, aim });
    }
  };

  if (testShip) addVisibleShip(testShip);
  if (pirateShip) addVisibleShip(pirateShip);
  for (const player of visiblePlayers.values()) addVisibleShip(player);
  interpolateMissiles(missileSprites);
  const projectiles = [];
  for (const missile of missileSprites.values()) {
    const x = width / 2 + missile.x - localSprite.x;
    const y = height / 2 + missile.y - localSprite.y;
    if (x >= -24 && y >= -24 && x <= width + 24 && y <= height + 24) {
      projectiles.push({ x, y, heading: missile.heading });
    }
  }
  const models = renderShipModels?.(entries, width, height, ratio, time, projectiles);

  for (const { sprite, x, y, aim } of entries) {
    const angle = Math.round(sprite.heading / SHIP_FRAME_STEP) % shipFrames.length;
    const index = (angle + shipFrames.length) % shipFrames.length;
    context.save();
    context.translate(x, y);
    if (!models && sprite.model === "pirate") {
      // The exhaust ports sit wider and farther aft than the civilian ship's.
      const heading = models ? sprite.heading : index * SHIP_FRAME_STEP;
      drawEngineFlames(time, pirateNozzles(heading), heading, ["#ff9c32", "#fff0a3"]);
    } else if (!models && time < (sprite.thrustUntil ?? 0)) {
      drawEngineFlames(time, shipFrames[index], models ? sprite.heading : index * SHIP_FRAME_STEP,
        engineModel(sprite.engineModel).exhaust);
    }
    if (!models) {
      if (sprite.model !== "pirate" && time >= (sprite.thrustUntil ?? 0)) {
        context.rotate(Math.sin(time / 700 + sprite.x * 0.012) * 0.025);
      }
      const frameX = (index % SHIP_FRAME_COLUMNS) * SHIP_FRAME_SIZE;
      const frameY = Math.floor(index / SHIP_FRAME_COLUMNS) * SHIP_FRAME_SIZE;
      const atlas = sprite.model === "pirate" ? pirateAtlas : ship;
      if (atlas.naturalWidth) context.drawImage(atlas, frameX, frameY, SHIP_FRAME_SIZE, SHIP_FRAME_SIZE,
        -SHIP_SIZE / 2, -SHIP_SIZE / 2, SHIP_SIZE, SHIP_SIZE);
    }
    context.restore();
    if (!models) {
      for (const [slot, weapon] of aim.entries()) {
        if (!weapon) continue;
        context.strokeStyle = "#253b53";
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(x + weapon.base.x, y + weapon.base.y);
        context.lineTo(x + weapon.muzzle.x, y + weapon.muzzle.y);
        context.stroke();
        context.fillStyle = LASER_MODELS[sprite[WEAPON_MOUNTS[slot].field]].color;
        context.fillRect(x + weapon.muzzle.x - 1, y + weapon.muzzle.y - 1, 2, 2);
      }
    }
  }
  if (models) context.drawImage(models, 0, 0, width, height);

  const lasersVisible = drawLaserShots(context, laserEffects, width / 2 - localSprite.x,
    height / 2 - localSprite.y, time, (shot) => {
      const shooter = visiblePlayers.get(shot.shooterId);
      if (!shooter?.hp) return shot;
      const { muzzle } = laserAim(shooter.heading, shot.slotIndex, shot.modelId,
        shot.targetX - shooter.x, shot.targetY - shooter.y, shooter.model);
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
  const missilesVisible = drawMissiles(context, missileSprites, missileImpacts, width, height,
    width / 2 - localSprite.x, height / 2 - localSprite.y, time, !models);
  return showShield || lasersVisible || missilesVisible || entries.some(({ sprite }) => sprite.model !== "pirate");
}
window.render_game_to_text = () => JSON.stringify({
  mode: !planetSurface.hidden ? "planet" : world.hidden ? "menu" : "world",
  coordinates: "Origin at top left, x right, y down",
  worldSize,
  sun: worldSize ? sunPosition(worldSize) : undefined,
  planet: worldSize ? currentPlanet(performance.now()) : undefined,
  flightDestination: flightRoute.at(-1),
  flightRoute,
  selectionId,
  cameraZoom,
  damageNumbers,
  testShip,
  pirateShip,
  missiles: [...missileSprites.values()],
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

  gameAudio.unlock();
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
      for (const shot of shots) {
        gameAudio.play(shot.model === "ion" ? "prism" : "laser", shot, localSprite);
        if (shot.explosion) gameAudio.play("explosion", shot.explosion, localSprite);
      }
      if (!frame && !world.hidden) frame = requestAnimationFrame(drawWorld);
    });
    room.onMessage("missile:launch", (position) => {
      if (activeRoom === room) gameAudio.play("launch", position, localSprite);
    });
    room.onMessage("missile:impacts", (impacts) => {
      if (activeRoom !== room) return;
      const time = performance.now();
      missileImpacts.push(...impacts.map((impact) => ({ ...impact, time })));
      for (const impact of impacts) {
        gameAudio.play(impact.explosion ? "explosion" : "impact", impact.explosion ?? impact, localSprite);
      }
      if (!frame && !world.hidden) frame = requestAnimationFrame(drawWorld);
    });
    room.onMessage("ship:explosion", (explosion) => {
      if (activeRoom !== room) return;
      missileImpacts.push({ explosion, time: performance.now() });
      gameAudio.play("explosion", explosion, localSprite);
    });
    room.onMessage("solar:hit", () => {
      if (activeRoom !== room) return;
      solarHitAt = performance.now();
      gameAudio.play("heat");
      if (!frame && !world.hidden) frame = requestAnimationFrame(drawWorld);
    });
    room.onMessage("damage:number", (hit) => {
      if (activeRoom !== room) return;
      addDamageNumber(damageNumbers, hit, performance.now());
      if (hit.shield) gameAudio.play("shield", hit, localSprite);
      if (hit.hull && hit.incoming) gameAudio.play("hull", hit, localSprite);
      if (!frame && !world.hidden) frame = requestAnimationFrame(drawWorld);
    });
    room.onMessage("flight:route", (route) => {
      if (activeRoom !== room) return;
      flightRoute = route;
      if (!frame && !world.hidden) frame = requestAnimationFrame(drawWorld);
    });
    room.onDrop(() => {
      gameAudio.setInGame(false);
      stopSteering();
      flightRoute = [];
      selectionId = undefined;
    });
    activeRoom = room;
    inventoryPanel.bind(room);
    menu.hidden = true;
    orbitSeconds = -1;

    room.onStateChange((state) => {
      const localPlayer = state.players.get(room.sessionId);
      if (!localPlayer) return;
      worldSize = state.size;
      if (orbitSeconds !== state.orbitSeconds) {
        orbitSeconds = state.orbitSeconds;
        orbitSampleAt = performance.now();
      }
      if (state.missiles) syncMissiles(missileSprites, state.missiles);
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
        const player = state.players.get(id);
        if (id !== room.sessionId && (!player?.online || player.landing === "landed" || player.landing === "landing")) {
          visiblePlayers.delete(id);
        }
      }
      for (const [id, player] of state.players) {
        if (id !== room.sessionId && (!player.online || player.landing === "landed" || player.landing === "landing")) continue;
        const sprite = visiblePlayers.get(id) ?? {
          id,
          x: player.x,
          y: player.y,
          heading: player.heading ?? 0,
          nickname: player.nickname,
          local: id === room.sessionId,
        };
        sprite.engineModel = player.engineModel;
        if ((sprite.hp === 0 && player.hp > 0) || (sprite.landing === "landed" && !player.landing)) {
          sprite.x = player.x;
          sprite.y = player.y;
          sprite.heading = player.heading ?? 0;
          sprite.thrustUntil = 0;
        }
        copyHull(sprite, player);
        sprite.targetX = player.x;
        sprite.targetY = player.y;
        sprite.targetHeading = player.heading ?? 0;
        visiblePlayers.set(id, sprite);
        if (sprite.local) {
          if (player.attackTarget && sprite.attackTarget !== player.attackTarget) gameAudio.play("attack");
          localSprite = sprite;
        }
        sprite.attackTarget = player.attackTarget;
        sprite.landing = player.landing;
      }
      const hull = `Прочность ${localPlayer.hp}/${localPlayer.maxHp} · Щит ${Math.ceil(localPlayer.shield)}/${localPlayer.maxShield}`;
      const sun = sunPosition(worldSize);
      const overheating = Math.hypot(localPlayer.x - sun.x, localPlayer.y - sun.y) < SUN_HEAT_RADIUS;
      const statusText = `${localPlayer.nickname} · ${hull} · Игроков: ${visiblePlayers.size}` +
        (localPlayer.hp ? (overheating ? " · Перегрев" : "") : " · Восстановление…") +
        (localPlayer.landing === "approach" ? " · Курс на Люмену" : "");
      if (status.textContent !== statusText) status.textContent = statusText;
      if (!localPlayer.hp) {
        stopSteering();
        flightRoute = [];
        selectionId = undefined;
      }
      inventoryPanel.setPilot(localPlayer.nickname);
      showPlanetPhase(localPlayer.landing);
      audioButton.hidden = false;
      gameAudio.setInGame(true);
      if (!world.hidden && !frame) frame = requestAnimationFrame(drawWorld);
    });
    room.onLeave(() => {
      gameAudio.setInGame(false);
      audioButton.hidden = true;
      stopSteering();
      laserEffects.length = 0;
      missileImpacts.length = 0;
      missileSprites.clear();
      flightHelp.hidden = true;
      sessionStorage.removeItem(sessionKey);
      status.textContent = "Соединение закрыто.";
      world.hidden = true;
      planetSurface.hidden = true;
      market.close();
      landingTransition.hidden = true;
      world.classList.remove("landing-zoom");
      clearHover();
      minimap.hidden = true;
      mapBounds = undefined;
      activeRoom = undefined;
      selectionId = undefined;
      targetStatus.hidden = true;
      solarHitAt = -Infinity;
      damageNumbers.length = 0;
      inventoryPanel.bind(null);
      cancelAnimationFrame(frame);
      frame = 0;
      visiblePlayers.clear();
      localSprite = undefined;
      flightRoute = [];
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
