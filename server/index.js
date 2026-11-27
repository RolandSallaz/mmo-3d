import { createHash } from "node:crypto";
import { fireLasers } from "./laser.js";
import { advanceMissile, missileSalvos } from "./missiles.js";
import { ErrorCode, Room, ServerError, defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { schema } from "@colyseus/schema";
import { MISSILE_MODEL, SHIELD_MODELS, WEAPON_MOUNTS } from "../shared/equipment.js";
import { advanceFlight, FLIGHT_TICK_MS } from "../shared/flight.js";
import { advanceSafeFlight, planFlight } from "../shared/solar-navigation.js";
import { SUN_HEAT_RADIUS, planetPosition, sunPosition } from "../shared/world.js";

import { applyInventoryMove, getInventory, initializeInventoryStore, loadCharacter } from "./inventory-store.js";

const WORLD_SIZE = 65_536;
const SUN = sunPosition(WORLD_SIZE);
const SOLAR_DAMAGE = 6;
const SOLAR_DAMAGE_INTERVAL = 500;
const orbitStartedAt = performance.now();
const PIRATE_ORBIT_RADIUS = 222;
const PIRATE_ORBIT_SPEED = 0.52;
const PIRATE_START_ANGLE = Math.PI * 0.42;
const PLAYER_HP = 100;
const PIRATE_HP = 150;
const TEST_SHIP_HP = 110;
const MAX_MISSILES = 640;
const RESPAWN_MS = 5000;
const SHIELD_RECHARGE_DELAY = 3800;
const SHIELD_RECHARGE_RATE = 15;
const HULL = { hp: "uint16", maxHp: "uint16", shield: "float32", maxShield: "uint16" };

function placePirate(pirate, angle, planet) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  pirate.x = planet.x + cos * PIRATE_ORBIT_RADIUS;
  pirate.y = planet.y + sin * PIRATE_ORBIT_RADIUS;
  pirate.heading = Math.atan2(-sin, -cos);
}
const WEAPON_SLOTS = Object.fromEntries(WEAPON_MOUNTS.map(({ field }) => [field, "string"]));
const Player = schema({ nickname: "string", x: "float32", y: "float32", heading: "float32", online: "boolean", attackTarget: "string", engineModel: "string", shieldModel: "string", ...HULL, ...WEAPON_SLOTS, landing: "string" });
const TestShip = schema({ x: "float32", y: "float32", heading: "float32", shieldModel: "string", ...HULL, ...WEAPON_SLOTS });
const Missile = schema({ x: "float32", y: "float32", heading: "float32", hp: "uint8", owner: "string" });
const WorldState = schema({ size: "uint32", players: { map: Player }, testShip: TestShip, pirate: TestShip, missiles: { map: Missile }, orbitSeconds: "uint32" });
const spawnPoints = Array.from({ length: 36 }, (_, index) => {
  const cell = (index + 14) % 36;
  return {
    x: WORLD_SIZE / 2 + (cell % 6 - 2) * 96,
    y: WORLD_SIZE / 2 + (Math.floor(cell / 6) - 2) * 96,
  };
}).filter(({ x, y }) => Math.hypot(x - SUN.x, y - SUN.y) >= SUN_HEAT_RADIUS + 48);

const activeLoadouts = new Map();

function updateLoadout(characterId, { equipment, revision }) {
  const loadout = activeLoadouts.get(characterId);
  if (!loadout) return;
  if (revision >= loadout.revision) {
    loadout.revision = revision;
    loadout.engineModel = equipment.engine ?? "";
    loadout.shieldModel = equipment.shield ?? "";
    for (const { id, field } of WEAPON_MOUNTS) loadout[field] = equipment[id] ?? "";
  }
  for (const player of loadout.players) {
    player.engineModel = loadout.engineModel;
    player.shieldModel = loadout.shieldModel;
    for (const { field } of WEAPON_MOUNTS) player[field] = loadout[field];
    player.maxShield = SHIELD_MODELS[loadout.shieldModel]?.capacity ?? 0;
    player.shield = Math.min(player.shield, player.maxShield);
  }
}

class WorldRoom extends Room {
  maxClients = 32;
  state = new WorldState({
    size: WORLD_SIZE,
    testShip: new TestShip({
      x: WORLD_SIZE / 2 + 100, y: WORLD_SIZE / 2 + 53, heading: 0.48,
      hp: TEST_SHIP_HP, maxHp: TEST_SHIP_HP, shield: 0, maxShield: 0, shieldModel: "",
    }),
    pirate: new TestShip({ hp: PIRATE_HP, maxHp: PIRATE_HP, shield: 45, maxShield: 45, shieldModel: "shield" }),
  });
  destinations = new Map();
  approaches = new Map();
  laserReadyAt = new Map();
  missileTargets = new Map();
  missileSequence = 0;
  lastHitAt = new WeakMap();
  solarDamageAt = new WeakMap();
  pirateAngle = PIRATE_START_ANGLE;

  onCreate() {
    this.updateOrbit(performance.now());
    const sendInventory = async (client, read) => {
      try {
        const inventory = await read();
        updateLoadout(client.auth.characterId, inventory);
        client.send("inventory:state", inventory);
      } catch (error) {
        console.error("Inventory request:", error.message);
        client.send("inventory:error", "Инвентарь временно недоступен. Попробуйте ещё раз.");
      }
    };
    this.onMessage("inventory:get", (client) =>
      sendInventory(client, () => getInventory(client.auth.characterId)));
    this.onMessage("inventory:move", (client, message) =>
      sendInventory(client, () => applyInventoryMove(client.auth.characterId, message)));
    this.onMessage("attack", (client, targetId) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.online || !player.hp || player.landing) return;
      if (targetId === "" || targetId === player.attackTarget) {
        player.attackTarget = "";
        return;
      }
      if (!this.findAttackTarget(client.sessionId, targetId)) return;
      player.attackTarget = targetId;
    });
    this.onMessage("move", (client, destination) => {
      const x = destination?.x;
      const y = destination?.y;
      const player = this.state.players.get(client.sessionId);
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || x > WORLD_SIZE || y < 0 || y > WORLD_SIZE ||
          !player?.online || !player.hp || (player.landing && player.landing !== "approach")) return;

      this.approaches.delete(client.sessionId);
      player.landing = "";
      const direct = destination.direct === true;
      const route = planFlight(player, { x, y }, WORLD_SIZE, direct);
      this.destinations.set(client.sessionId, { route, direct });
      client.send("flight:route", route);
    });
    this.onMessage("planet:land", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.online || !player.hp || player.landing) return;
      this.destinations.delete(client.sessionId);
      player.attackTarget = "";
      player.landing = "approach";
      this.approaches.set(client.sessionId, { route: [], refreshAt: 0 });
    });
    this.onMessage("planet:launch", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.online || player.landing !== "landed") return;
      const planet = planetPosition(WORLD_SIZE, performance.now() - orbitStartedAt);
      const dx = planet.x - SUN.x;
      const dy = planet.y - SUN.y;
      const distance = Math.hypot(dx, dy);
      player.x = planet.x + dx * 190 / distance;
      player.y = planet.y + dy * 190 / distance;
      player.heading = Math.atan2(dx, -dy);
      player.landing = "";
    });

    this.setSimulationInterval((deltaMs) => {
      const seconds = Math.min(deltaMs, 100) / 1000;
      this.pirateAngle = (this.pirateAngle + PIRATE_ORBIT_SPEED * seconds) % (2 * Math.PI);
      const now = performance.now();
      this.updateOrbit(now);
      for (const player of this.state.players.values()) this.rechargeShield(player, seconds, now);
      this.rechargeShield(this.state.pirate, seconds, now);
      for (const [id, { route, direct }] of this.destinations) {
        const player = this.state.players.get(id);
        const fly = direct ? advanceFlight : advanceSafeFlight;
        if (fly(player, route[0], seconds, WORLD_SIZE)) {
          route.shift();
          if (!route.length) this.destinations.delete(id);
          this.clients.getById(id)?.send("flight:route", route);
        }
      }
      this.updateMissiles(seconds, now);
      for (const client of this.clients) {
        const player = this.state.players.get(client.sessionId);
        if (player?.landing === "approach" && player.hp) this.approachPlanet(client, player, seconds, now);
        if (player?.landing === "landing" || player?.landing === "landed") continue;
        if (player?.online && player.hp && this.applySolarDamage(player, client, now)) continue;
        if (player?.online && player.hp && player.attackTarget) {
          this.updateAttack(client, player, now);
        }
      }
    }, FLIGHT_TICK_MS);
  }

  approachPlanet(client, player, seconds, now) {
    const approach = this.approaches.get(client.sessionId);
    if (!approach) return;
    const planet = planetPosition(WORLD_SIZE, now - orbitStartedAt);
    const distance = Math.hypot(player.x - planet.x, player.y - planet.y);
    if (distance <= 10) {
      Object.assign(player, planet);
      player.landing = "landing";
      this.approaches.delete(client.sessionId);
      client.send("flight:route", []);
      this.clock.setTimeout(() => {
        if (player.landing === "landing") player.landing = "landed";
      }, 1700);
      return;
    }
    if (!approach.route.length || now >= approach.refreshAt) {
      approach.route = planFlight(player, planet, WORLD_SIZE);
      approach.refreshAt = now + (distance < 100 ? 250 : 700);
      client.send("flight:route", approach.route);
    }
    if (advanceSafeFlight(player, approach.route[0], seconds, WORLD_SIZE)) approach.route.shift();
  }

  updateOrbit(now) {
    const elapsed = now - orbitStartedAt;
    this.state.orbitSeconds = Math.floor(elapsed / 1000);
    placePirate(this.state.pirate, this.pirateAngle, planetPosition(WORLD_SIZE, elapsed));
  }

  findAttackTarget(attackerId, targetId) {
    if (typeof targetId !== "string" || targetId === attackerId) return;
    if (targetId.startsWith("missile:")) {
      const missileId = targetId.slice("missile:".length);
      const ship = this.state.missiles.get(missileId);
      return ship?.hp && ship.owner !== attackerId ? { missileId, ship } : undefined;
    }
    if (targetId === "npc:pirate" || targetId === "npc:test") {
      const ship = targetId === "npc:pirate" ? this.state.pirate : this.state.testShip;
      return ship.hp ? { ship, effectId: targetId } : undefined;
    }
    const ship = this.state.players.get(targetId);
    if (ship?.online && ship.hp && ship.landing !== "landed" && ship.landing !== "landing") return { id: targetId, ship };
  }

  updateAttack(client, player, now) {
    const target = this.findAttackTarget(client.sessionId, player.attackTarget);
    if (!target) {
      player.attackTarget = "";
      return;
    }

    const canLaunch = target.missileId === undefined &&
      WEAPON_MOUNTS.some(({ field }) => player[field] === "missile");
    const readyAt = this.laserReadyAt.get(client.sessionId) ?? WEAPON_MOUNTS.map(() => 0);
    if (canLaunch) {
      const launches = missileSalvos(player, target.ship, readyAt, now, WORLD_SIZE,
        MAX_MISSILES - this.state.missiles.size);
      if (launches.length) this.broadcast("missile:launch", { x: player.x, y: player.y });
      for (const launch of launches) {
        const id = String(this.missileSequence++);
        this.state.missiles.set(id, new Missile({
          ...launch, hp: MISSILE_MODEL.missileHp, owner: client.sessionId,
        }));
        this.missileTargets.set(id, { target, launchedAt: now });
        this.laserReadyAt.set(client.sessionId, readyAt);
      }
    }
    const shots = fireLasers(player, target.ship, readyAt, now, WORLD_SIZE, target.missileId !== undefined ? 4 : undefined);
    if (!shots.length) return;

    this.laserReadyAt.set(client.sessionId, readyAt);
    const effects = [];
    for (const { damage, slotIndex, cooldown, ...shot } of shots) {
      readyAt[slotIndex] = now + cooldown;
      const destroyed = this.damageShip(target, damage, now, client.sessionId);
      effects.push({
        ...shot, shooterId: client.sessionId, slotIndex, hit: true, destroyed,
        explosion: destroyed && target.missileId === undefined ? { x: target.ship.x, y: target.ship.y } : undefined,
      });
      if (destroyed) {
        player.attackTarget = "";
        break;
      }
    }
    this.broadcast("laser:shots", effects);
  }

  updateMissiles(seconds, now) {
    const impacts = [];
    for (const [id, { target, launchedAt }] of this.missileTargets) {
      const missile = this.state.missiles.get(id);
      const landed = target.ship.landing === "landing" || target.ship.landing === "landed";
      const result = landed ? "expired" : advanceMissile(missile, target.ship, (now - launchedAt) / 1000, seconds, WORLD_SIZE);
      if (result === "flying") continue;
      if (result === "hit") {
        const destroyed = this.damageShip(target, MISSILE_MODEL.damage, now, missile.owner);
        impacts.push({
          x: missile.x, y: missile.y,
          explosion: destroyed && target.missileId === undefined ? { x: target.ship.x, y: target.ship.y } : undefined,
        });
      }
      this.state.missiles.delete(id);
      this.missileTargets.delete(id);
    }
    if (impacts.length) this.broadcast("missile:impacts", impacts);
  }

  rechargeShield(ship, seconds, now) {
    if (!ship.hp || ship.shield >= ship.maxShield || now - (this.lastHitAt.get(ship) ?? -Infinity) < SHIELD_RECHARGE_DELAY) return;
    ship.shield = Math.min(ship.maxShield, ship.shield + SHIELD_RECHARGE_RATE * seconds);
  }

  applySolarDamage(ship, client, now) {
    if (Math.hypot(ship.x - SUN.x, ship.y - SUN.y) >= SUN_HEAT_RADIUS ||
        now < (this.solarDamageAt.get(ship) ?? 0)) return false;
    this.solarDamageAt.set(ship, now + SOLAR_DAMAGE_INTERVAL);
    client.send("solar:hit");
    if (!this.damageShip({ ship, id: client.sessionId }, SOLAR_DAMAGE, now)) return false;
    this.broadcast("ship:explosion", { x: ship.x, y: ship.y });
    return true;
  }

  damageShip({ ship, id, missileId, effectId }, damage, now, attackerId) {
    if (!ship.hp) return false;

    const absorbed = missileId === undefined ? Math.min(ship.shield, damage) : 0;
    const hull = Math.min(ship.hp, Math.ceil(damage - absorbed));
    ship.hp -= hull;
    if (missileId === undefined) {
      ship.shield -= absorbed;
      this.lastHitAt.set(ship, now);
    }
    const hit = {
      target: id ?? effectId ?? `missile:${missileId}`,
      x: ship.x, y: ship.y, hull, shield: absorbed,
    };
    if (attackerId && attackerId !== id) this.clients.getById(attackerId)?.send("damage:number", hit);
    if (id) this.clients.getById(id)?.send("damage:number", { ...hit, incoming: true });
    if (ship.hp) return false;

    if (missileId !== undefined) {
      this.state.missiles.delete(missileId);
      this.missileTargets.delete(missileId);
      return true;
    }

    if (id) {
      this.destinations.delete(id);
      this.approaches.delete(id);
      ship.landing = "";
      ship.attackTarget = "";
    }
    this.clock.setTimeout(() => {
      if (id && this.state.players.get(id) !== ship) return;
      if (id) {
        Object.assign(ship, this.findSpawn());
        ship.heading = 0;
      }
      ship.hp = ship.maxHp;
      ship.shield = ship.maxShield;
    }, RESPAWN_MS);
    return true;
  }

  static async onAuth(_token, options) {
    const nickname = typeof options.nickname === "string" ? options.nickname.trim() : "";
    if (!nickname || nickname.length > 24) {
      throw new ServerError(ErrorCode.AUTH_FAILED, "Nickname must be 1–24 characters.");
    }
    const credential = options?.inventoryToken;
    if (typeof credential !== "string" || !/^[a-f0-9]{64}$/.test(credential)) {
      throw new ServerError(ErrorCode.AUTH_FAILED, "Invalid character credential.");
    }
    const characterId = createHash("sha256").update(credential).digest("hex");
    return { ...await loadCharacter(characterId, nickname), characterId };
  }

  findSpawn() {
    const players = [...this.state.players.values()].filter((player) => player.hp);
    return spawnPoints.find(({ x, y }) =>
      players.every((player) => Math.hypot(player.x - x, player.y - y) >= 56)
    ) ?? spawnPoints.find(({ x, y }) =>
      players.every((player) => player.x !== x || player.y !== y)
    );
  }

  onJoin(client, _options, auth) {
    const { nickname, characterId } = auth;
    const player = new Player({
      nickname, ...this.findSpawn(), heading: 0, online: true, attackTarget: "",
      hp: PLAYER_HP, maxHp: PLAYER_HP, shield: 0, maxShield: 0,
    });
    if (!activeLoadouts.has(characterId)) {
      activeLoadouts.set(characterId, { revision: -1, players: new Set() });
    }
    activeLoadouts.get(characterId).players.add(player);
    updateLoadout(characterId, auth);
    player.shield = player.maxShield;
    this.state.players.set(client.sessionId, player);
  }

  onDrop(client) {
    this.destinations.delete(client.sessionId);
    this.approaches.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.online = false;
      player.attackTarget = "";
      if (player.landing === "approach") player.landing = "";
    }
    this.allowReconnection(client, 120);
  }

  onReconnect(client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.online = true;
  }

  onLeave(client) {
    this.laserReadyAt.delete(client.sessionId);
    const characterId = client.auth?.characterId;
    const loadout = activeLoadouts.get(characterId);
    if (loadout) {
      loadout.players.delete(this.state.players.get(client.sessionId));
      if (!loadout.players.size) activeLoadouts.delete(characterId);
    }
    this.destinations.delete(client.sessionId);
    this.approaches.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }
}

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { world: defineRoom(WorldRoom) },
});

await initializeInventoryStore();
await server.listen(Number(process.env.PORT ?? 2567));
