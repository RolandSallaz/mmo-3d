import { ITEMS } from "../shared/inventory.js";

const CATALOG = ["engine", "shield", "scanner", "pulse", "ion", "missile"];

export function setupPlanetMarket(requestInventory) {
  const buy = document.querySelector("#planet-buy");
  const sell = document.querySelector("#planet-sell");
  const panel = document.querySelector("#planet-market");
  const title = document.querySelector("#planet-market-title");
  const status = document.querySelector("#planet-market-status");
  const list = document.querySelector("#planet-market-items");
  let mode;

  function showItems(items) {
    list.replaceChildren(...items.map(([id, quantity]) => {
      const row = document.createElement("li");
      row.textContent = quantity ? `${ITEMS[id].name} × ${quantity}` : ITEMS[id].name;
      return row;
    }));
  }

  function show(nextMode) {
    mode = mode === nextMode ? undefined : nextMode;
    panel.hidden = !mode;
    buy.setAttribute("aria-expanded", String(mode === "buy"));
    sell.setAttribute("aria-expanded", String(mode === "sell"));
    list.replaceChildren();
    status.textContent = "";
    if (mode === "buy") {
      title.textContent = "Каталог";
      showItems(CATALOG.map((id) => [id]));
    } else if (mode === "sell") {
      title.textContent = "Грузовой отсек";
      status.textContent = "Загружаем грузовой отсек…";
      requestInventory();
    }
  }

  buy.addEventListener("click", () => show("buy"));
  sell.addEventListener("click", () => show("sell"));

  return {
    close: () => show(undefined),
    update({ cargo }) {
      if (mode !== "sell") return;
      const quantities = new Map();
      for (const id of cargo) {
        if (id && Object.hasOwn(ITEMS, id)) quantities.set(id, (quantities.get(id) ?? 0) + 1);
      }
      status.textContent = quantities.size ? "" : "Грузовой отсек пуст.";
      showItems([...quantities]);
    },
    showError(message) {
      if (mode === "sell") status.textContent = message;
    },
  };
}
