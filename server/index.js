import { ErrorCode, Room, ServerError, defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { schema } from "@colyseus/schema";

const Player = schema({ nickname: "string", x: "uint16", y: "uint16" });
const WorldState = schema({ players: { map: Player } });
const spawnPoints = Array.from({ length: 36 }, (_, index) => {
  const cell = (index + 14) % 36;
  return { x: 80 + (cell % 6) * 96, y: 80 + Math.floor(cell / 6) * 96 };
});

class WorldRoom extends Room {
  maxClients = 32;
  state = new WorldState();

  static async onAuth(_token, options) {
    const nickname = typeof options.nickname === "string" ? options.nickname.trim() : "";
    if (!nickname || nickname.length > 24) {
      throw new ServerError(ErrorCode.AUTH_FAILED, "Nickname must be 1–24 characters.");
    }
    return { nickname };
  }

  onJoin(client, _options, { nickname }) {
    const occupied = new Set(Array.from(this.state.players.values(), (player) => player.x + player.y * 640));
    const spawn = spawnPoints.find(({ x, y }) => !occupied.has(x + y * 640));
    this.state.players.set(client.sessionId, new Player({ nickname, ...spawn }));
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }
}

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { world: defineRoom(WorldRoom) },
});

await server.listen(Number(process.env.PORT ?? 2567));
