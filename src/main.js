import { Client } from "@colyseus/sdk";

const button = document.querySelector("#join");
const status = document.querySelector("#status");
const endpoint = import.meta.env.VITE_COLYSEUS_URL ||
  (import.meta.env.DEV ? "http://localhost:2567" : "");

if (!endpoint) {
  button.disabled = true;
  status.textContent = "Адрес игрового сервера пока не настроен.";
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Подключение…";

  try {
    const room = await new Client(endpoint).joinOrCreate("world");
    room.onStateChange((state) => {
      status.textContent = `Игроков в комнате: ${state.players.length}`;
    });
    room.onLeave(() => {
      status.textContent = "Соединение закрыто.";
      button.disabled = false;
    });
  } catch (error) {
    console.error(error);
    status.textContent = "Не удалось подключиться. Попробуйте ещё раз.";
    button.disabled = false;
  }
});
