import { Client } from "@colyseus/sdk";
import spaceshipUrl from "./spaceship.webp";

const menu = document.querySelector("#menu");
const nicknameInput = document.querySelector("#nickname");
const button = document.querySelector("#join");
const status = document.querySelector("#status");
const world = document.querySelector("#world");
const context = world.getContext("2d");
const ship = new Image();
ship.src = spaceshipUrl;
let visiblePlayers = [];

function drawWorld() {
  context.fillStyle = "#000";
  context.fillRect(0, 0, world.width, world.height);
  context.font = "13px system-ui";
  context.textAlign = "center";
  for (const { nickname, x, y, local } of visiblePlayers) {
    context.drawImage(ship, x - 28, y - 28, 56, 56);
    context.fillStyle = local ? "#7ee8ff" : "#fff";
    context.fillText(nickname, x, y + 42, 90);
  }
}

window.render_game_to_text = () => JSON.stringify({
  mode: world.hidden ? "menu" : "world",
  coordinates: "Origin at top left, x right, y down",
  players: visiblePlayers,
});
const endpoint = import.meta.env.VITE_COLYSEUS_URL ||
  (import.meta.env.DEV ? "http://localhost:2567" : "");

if (!endpoint) {
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

  button.disabled = true;
  nicknameInput.disabled = true;
  status.textContent = "Подключение…";

  try {
    await ship.decode();
    const room = await new Client(endpoint).joinOrCreate("world", { nickname });
    menu.hidden = true;

    room.onStateChange((state) => {
      const localPlayer = state.players.get(room.sessionId);
      if (!localPlayer) return;

      visiblePlayers = Array.from(state.players, ([id, player]) => ({
        nickname: player.nickname,
        x: player.x,
        y: player.y,
        local: id === room.sessionId,
      }));
      status.textContent = `${localPlayer.nickname} · Игроков в комнате: ${visiblePlayers.length}`;
      world.hidden = false;
      drawWorld();
    });
    room.onLeave(() => {
      status.textContent = "Соединение закрыто.";
      world.hidden = true;
      visiblePlayers = [];
      menu.hidden = false;
      nicknameInput.disabled = false;
      button.disabled = false;
    });
  } catch (error) {
    console.error(error);
    status.textContent = "Не удалось подключиться. Попробуйте ещё раз.";
    nicknameInput.disabled = false;
    button.disabled = false;
  }
});
