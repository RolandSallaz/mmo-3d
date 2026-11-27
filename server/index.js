import { createHash } from "node:crypto";
import { fireLasers } from "./laser.js";
import { ErrorCode, Room, ServerError, defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { schema } from "@colyseus/schema";
import { SHIELD_MODELS } from "../shared/equipment.js";
import { advanceFlight, FLIGHT_TICK_MS } from "../shared/flight.js";
import { planetPosition } from "../shared/world.js";

import { applyInventoryMove, getInventory, initializeInventoryStore, loadCharacter } from "./inventory-store.js";

const WORLD_SIZE = 65_536;
const PLANET = planetPosition(WORLD_SIZE);
const PIRATE_ORBIT_RADIUS = 222;
const PIRATE_ORBIT_SPEED = 0.52;
const PIRATE_START_ANGLE = Math.PI * 0.42;
const PLAYER_HP = 100;
const PIRATE_HP = 150;
const TEST_SHIP_HP = 110;
const RESPAWN_MS = 5000;
const SHIELD_RECHARGE_DELAY = 3800;
const SHIELD_RECHARGE_RATE = 15;
const HULL = { hp: "uint16", maxHp: "uint16", shield: "float32", maxShield: "uint16" };

function placePirate(pirate, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  pirate.x = PLANET.x + cos * PIRATE_ORBIT_RADIUS;
  pirate.y = PLANET.y + sin * PIRATE_ORBIT_RADIUS;
  pirate.heading = Math.atan2(-sin, -cos);
}
const Player = schema({ nickname: "string", x: "float32", y: "float32", heading: "float32", online: "boolean", engineModel: "string", shieldModel: "string", ...HULL });
const TestShip = schema({ x: "float32", y: "float32", heading: "float32", shieldModel: "string", ...HULL });
const WorldState = schema({ size: "uint32", players: { map: Player }, testShip: TestShip, pirate: TestShip });
const spawnPoints = Array.from({ length: 36 }, (_, index) => {
  const cell = (index + 14) % 36;
  return {
    x: WORLD_SIZE / 2 + (cell % 6 - 2) * 96,
    y: WORLD_SIZE / 2 + (Math.floor(cell / 6) - 2) * 96,
  };
});

const activeLoadouts = new Map();

function updateLoadout(characterId, { equipment, revision }) {
  const loadout = activeLoadouts.get(characterId);
  if (!loadout) return;
  if (revision >= loadout.revision) {
    loadout.revision = revision;
    loadout.engineModel = equipment.engine ?? "";
    loadout.shieldModel = equipment.shield ?? "";
    loadout.weapons = {
      "weapon-left": equipment["weapon-left"],
      "weapon-right": equipment["weapon-right"],
    };
  }
  for (const player of loadout.players) {
    player.engineModel = loadout.engineModel;
    player.shieldModel = loadout.shieldModel;
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
  laserReadyAt = new Map();
  lastHitAt = new WeakMap();
  pirateAngle = PIRATE_START_ANGLE;

  onCreate() {
    placePirate(this.state.pirate, this.pirateAngle);
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
    this.onMessage("laser:fire", (client, aim) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.online || !player.hp || !Number.isFinite(aim?.x) || !Number.isFinite(aim?.y) ||
          aim.x < 0 || aim.x > WORLD_SIZE || aim.y < 0 || aim.y > WORLD_SIZE ||
          Math.hypot(aim.x - player.x, aim.y - player.y) < 2) return;
      const readyAt = this.laserReadyAt.get(client.sessionId) ?? [0, 0];
      const weapons = activeLoadouts.get(client.auth.characterId)?.weapons;
      const targets = [{ ship: this.state.pirate }, { ship: this.state.testShip }];
      for (const [id, ship] of this.state.players) {
        if (id !== client.sessionId && ship.online) targets.push({ id, ship });
      }
      const now = performance.now();
      const shots = fireLasers(player, aim, weapons, readyAt, now, targets, WORLD_SIZE);
      if (!shots.length) return;

      this.laserReadyAt.set(client.sessionId, readyAt);
      this.broadcast("laser:shots", shots.map(({ target, damage, ...shot }) => {
        const destroyed = target ? this.damageShip(target, damage, now) : false;
        return { ...shot, hit: Boolean(target), destroyed };
      }));
    });
    this.onMessage("move", (client, destination) => {
      const x = destination?.x;
      const y = destination?.y;
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || x > WORLD_SIZE || y < 0 || y > WORLD_SIZE ||
          !this.state.players.get(client.sessionId)?.hp) return;

      this.destinations.set(client.sessionId, { x, y });
    });

    this.setSimulationInterval((deltaMs) => {
      const seconds = Math.min(deltaMs, 100) / 1000;
      this.pirateAngle = (this.pirateAngle + PIRATE_ORBIT_SPEED * seconds) % (2 * Math.PI);
      placePirate(this.state.pirate, this.pirateAngle);
      const now = performance.now();
      for (const player of this.state.players.values()) this.rechargeShield(player, seconds, now);
      this.rechargeShield(this.state.pirate, seconds, now);
      for (const [id, destination] of this.destinations) {
        const player = this.state.players.get(id);
        if (advanceFlight(player, destination, seconds, WORLD_SIZE)) {
          this.destinations.delete(id);
        }
      }
    }, FLIGHT_TICK_MS);
  }

  rechargeShield(ship, seconds, now) {
    if (!ship.hp || ship.shield >= ship.maxShield || now - (this.lastHitAt.get(ship) ?? -Infinity) < SHIELD_RECHARGE_DELAY) return;
    ship.shield = Math.min(ship.maxShield, ship.shield + SHIELD_RECHARGE_RATE * seconds);
  }

  damageShip({ ship, id }, damage, now) {
    if (!ship.hp) return false;

    this.lastHitAt.set(ship, now);
    const absorbed = Math.min(ship.shield, damage);
    ship.shield -= absorbed;
    ship.hp = Math.max(0, ship.hp - Math.ceil(damage - absorbed));
    if (ship.hp) return false;

    if (id) this.destinations.delete(id);
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
      nickname, ...this.findSpawn(), heading: 0, online: true,
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
    const player = this.state.players.get(client.sessionId);
    if (player) player.online = false;
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
    this.state.players.delete(client.sessionId);
  }
}

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { world: defineRoom(WorldRoom) },
});

await initializeInventoryStore();
await server.listen(Number(process.env.PORT ?? 2567));
