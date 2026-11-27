import { ErrorCode, Room, ServerError, defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { schema } from "@colyseus/schema";

const WorldState = schema({ players: { map: "string" } });

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
    this.state.players.set(client.sessionId, nickname);
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
