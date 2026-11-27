import { Client } from "@colyseus/sdk";

const menu = document.querySelector("#menu");
const nicknameInput = document.querySelector("#nickname");
const button = document.querySelector("#join");
const status = document.querySelector("#status");
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
    const room = await new Client(endpoint).joinOrCreate("world", { nickname });
    menu.hidden = true;

    room.onStateChange((state) => {
      const acceptedNickname = state.players.get(room.sessionId);
      if (acceptedNickname) {
        status.textContent = `${acceptedNickname} · Игроков в комнате: ${state.players.size}`;
      }
    });
    room.onLeave(() => {
      status.textContent = "Соединение закрыто.";
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
