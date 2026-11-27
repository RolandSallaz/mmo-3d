import { Room, defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { schema } from "@colyseus/schema";

const WorldState = schema({ players: ["string"] });

class WorldRoom extends Room {
  maxClients = 32;
  state = new WorldState();

  onJoin(client) {
    this.state.players.push(client.sessionId);
  }

  onLeave(client) {
    const index = this.state.players.indexOf(client.sessionId);
    if (index >= 0) this.state.players.splice(index, 1);
  }
}

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { world: defineRoom(WorldRoom) },
});

await server.listen(Number(process.env.PORT ?? 2567));
