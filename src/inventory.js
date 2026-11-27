import { engineModel } from "../shared/equipment.js";
import {
  ITEMS, SHIP_SLOTS, canMoveInventoryItem, defaultInventoryDestination, inventoryItemAt,
} from "../shared/inventory.js";

const ICONS = ["engine", "shield", "scanner", "alloy", "pulse", "ion"];

function itemIcon(item) {
  const icon = document.createElement("span");
  const index = ICONS.indexOf(ITEMS[item]?.icon ?? item);
  icon.className = "inventory-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.style.backgroundPosition = `${index % 3 * 50}% ${Math.floor(index / 3) * 100}%`;
  return icon;
}

export function setupInventory(beforeOpen) {
  const toggle = document.querySelector("#inventory-toggle");
  const dialog = document.querySelector("#inventory");
  const pilot = dialog.querySelector("#inventory-pilot");
  const slots = dialog.querySelector("#ship-slots");
  const grid = dialog.querySelector("#cargo-grid");
  const count = dialog.querySelector("#cargo-count");
  const title = dialog.querySelector("#item-title");
  const description = dialog.querySelector("#item-description");
  const action = dialog.querySelector("#item-action");
  const itemMenu = dialog.querySelector("#item-menu");
  const ghost = document.createElement("div");
  ghost.className = "inventory-drag-ghost";
  ghost.hidden = true;
  ghost.setAttribute("aria-hidden", "true");
  dialog.append(ghost);

  const shipSpeed = dialog.querySelector("#ship-speed");
  const shipTurn = dialog.querySelector("#ship-turn-speed");

  let room;
  let inventory;
  let selection;
  let pending = false;
  let drag;
  let dropSlot;
  let ignoreClick = false;
  const itemButtons = new Map();
  const dropTargets = new Map();
  const positions = new WeakMap();

  function setPosition(element, position) {
    element.dataset.inventorySlot = "";
    positions.set(element, position);
    dropTargets.set(position, element);
  }

  function showSelection() {
    const item = ITEMS[inventoryItemAt(inventory, selection)];
    const destination = defaultInventoryDestination(inventory, selection);
    for (const [position, button] of itemButtons) {
      button.setAttribute("aria-pressed", String(position === selection));
      button.classList.toggle("slot-compatible", typeof selection === "number" &&
        typeof position === "string" && canMoveInventoryItem(inventory, selection, position));
    }

    const selectedSlot = SHIP_SLOTS.find(({ id }) => id === selection);
    title.textContent = item?.name ?? selectedSlot?.name ?? "";
    description.textContent = item?.description ??
      (selectedSlot ? "Свободный слот" : inventory ? "" : "Загружаем инвентарь…");
    action.hidden = !item || (typeof selection === "number" && !item.slot);
    action.disabled = pending || destination === undefined;
    action.textContent = typeof selection === "number" ? "Установить" : "Снять в грузовой отсек";
    if (!itemMenu.hidden) positionItemMenu();
  }

  function positionItemMenu() {
    const button = itemButtons.get(selection);
    if (!button) {
      itemMenu.hidden = true;
      return;
    }

    const bounds = button.getBoundingClientRect();
    const width = itemMenu.offsetWidth;
    const height = itemMenu.offsetHeight;
    const gap = 8;
    let x = bounds.right + gap;
    let y = bounds.top;
    if (x + width > window.innerWidth - gap) {
      x = bounds.left - width - gap;
      if (x < gap) {
        x = bounds.left + (bounds.width - width) / 2;
        y = bounds.top - height - gap;
        if (y < gap) y = bounds.bottom + gap;
      }
    }
    itemMenu.style.left = `${Math.max(gap, Math.min(x, window.innerWidth - width - gap))}px`;
    itemMenu.style.top = `${Math.max(gap, Math.min(y, window.innerHeight - height - gap))}px`;
  }
  function closeItemMenu() {
    itemMenu.hidden = true;
  }

  function clearSelection(blur = false) {
    if (blur) itemButtons.get(selection)?.blur();
    selection = undefined;
    closeItemMenu();
    showSelection();
  }

  dialog.querySelector("#item-menu-close").addEventListener("click", () => clearSelection(true));
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || itemMenu.hidden) return;
    event.preventDefault();
    const anchor = itemButtons.get(selection);
    clearSelection();
    anchor?.focus();
  });
  dialog.addEventListener("scroll", () => {
    if (!itemMenu.hidden) positionItemMenu();
  });
  window.addEventListener("resize", () => {
    if (!itemMenu.hidden) positionItemMenu();
  });

  function moveItem(source, destination = defaultInventoryDestination(inventory, source)) {
    if (!room || pending || !canMoveInventoryItem(inventory, source, destination)) return;
    clearSelection(true);
    pending = true;
    action.disabled = true;
    room.send("inventory:move", { source, destination, revision: inventory.revision });
  }

  function itemButton(position, itemId, label, emptyIcon) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inventory-item";
    button.classList.toggle("slot-empty", !itemId);
    button.append(itemIcon(itemId ?? emptyIcon));
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", (event) => {
      if (pending) return;
      if (typeof selection === "number" && typeof position === "string" &&
          canMoveInventoryItem(inventory, selection, position)) {
        moveItem(selection, position);
        return;
      }
      if (selection === position || !itemId) {
        clearSelection(event.detail > 0);
        if (!itemId && event.detail > 0) button.blur();
        return;
      }
      selection = position;
      itemMenu.hidden = false;
      showSelection();
    });
    itemButtons.set(position, button);
    return button;
  }

  function render(snapshot) {
    cancelDrag();
    inventory = snapshot;
    const engine = engineModel(inventory.equipment.engine);
    shipSpeed.textContent = `${engine.speed} ед/с`;
    shipTurn.textContent = `${Math.round(engine.turnSpeed * 180 / Math.PI)}°/с`;
    pending = false;
    itemButtons.clear();
    dropTargets.clear();
    slots.replaceChildren(...SHIP_SLOTS.map(({ id, name, icon }) => {
      const itemId = inventory.equipment[id];
      const label = itemId ? `${name}: ${ITEMS[itemId].name}` : `${name}: свободен`;
      const slot = itemButton(id, itemId, label, icon);
      slot.classList.add("ship-slot");
      slot.dataset.slot = id;
      setPosition(slot, id);
      return slot;
    }));

    grid.replaceChildren(...inventory.cargo.map((itemId, index) => {
      const cell = document.createElement("div");
      cell.className = "cargo-cell";
      setPosition(cell, index);
      if (itemId) cell.append(itemButton(index, itemId, ITEMS[itemId].name));
      return cell;
    }));
    count.textContent = `${inventory.cargo.filter(Boolean).length} / ${inventory.cargo.length}`;
    showSelection();
  }

  function slotUnderPointer(event) {
    return document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-inventory-slot]");
  }

  function cancelDrag() {
    if (!drag) return;
    const { id, element } = drag;
    drag = undefined;
    element.classList.remove("drag-source");
    for (const slot of dropTargets.values()) slot.classList.remove("drop-compatible");
    dropSlot?.classList.remove("drop-target");
    dropSlot = undefined;
    ghost.hidden = true;
    if (dialog.hasPointerCapture(id)) dialog.releasePointerCapture(id);
  }

  dialog.addEventListener("pointerdown", (event) => {
    if (event.target.closest("#item-menu")) return;
    closeItemMenu();
    if (!inventory || pending || drag || event.button !== 0 || !event.isPrimary) return;
    const element = event.target.closest("[data-inventory-slot]");
    const source = positions.get(element);
    const item = inventoryItemAt(inventory, source);
    if (!item) return;
    drag = { id: event.pointerId, source, element, x: event.clientX, y: event.clientY };
  });

  dialog.addEventListener("pointermove", (event) => {
    if (event.pointerId !== drag?.id) return;
    if (ghost.hidden) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      clearSelection(true);
      dialog.setPointerCapture(event.pointerId);
      drag.element.classList.add("drag-source");
      for (const [position, slot] of dropTargets) {
        slot.classList.toggle("drop-compatible", canMoveInventoryItem(inventory, drag.source, position));
      }
      ghost.replaceChildren(itemIcon(inventoryItemAt(inventory, drag.source)));
      ghost.hidden = false;
    }

    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    const target = slotUnderPointer(event);
    const next = canMoveInventoryItem(inventory, drag.source, positions.get(target)) ? target : undefined;
    if (dropSlot !== next) {
      dropSlot?.classList.remove("drop-target");
      next?.classList.add("drop-target");
      dropSlot = next;
    }
  });

  dialog.addEventListener("pointerup", (event) => {
    if (event.pointerId !== drag?.id) return;
    const { source } = drag;
    const didDrag = !ghost.hidden;
    const destination = didDrag ? positions.get(slotUnderPointer(event)) : undefined;
    cancelDrag();
    if (!didDrag) return;
    ignoreClick = true;
    setTimeout(() => { ignoreClick = false; }, 0);
    if (destination !== undefined) moveItem(source, destination);
  });

  dialog.addEventListener("click", (event) => {
    if (ignoreClick) {
      event.stopImmediatePropagation();
      return;
    }
    if (!event.target.closest(".inventory-item, #item-menu") &&
        (selection !== undefined || !itemMenu.hidden)) clearSelection(event.detail > 0);
  }, true);
  for (const type of ["pointercancel", "lostpointercapture"]) {
    dialog.addEventListener(type, (event) => {
      if (event.pointerId === drag?.id &&
          (type !== "lostpointercapture" || event.target === dialog)) cancelDrag();
    });
  }
  dialog.addEventListener("close", () => {
    cancelDrag();
    clearSelection();
  });

  toggle.addEventListener("click", () => {
    if (!room) return;
    beforeOpen();
    selection = undefined;
    showSelection();
    dialog.showModal();
    room.send("inventory:get");
  });

  action.addEventListener("click", () => moveItem(selection));

  return {
    bind(nextRoom) {
      room = nextRoom;
      toggle.hidden = true;
      dialog.close();
      cancelDrag();
      inventory = undefined;
      selection = undefined;
      pending = false;
      itemButtons.clear();
      dropTargets.clear();
      slots.replaceChildren();
      grid.replaceChildren();
      count.textContent = "";
      if (!room) return;

      const boundRoom = room;
      room.onMessage("inventory:state", (snapshot) => {
        if (room === boundRoom) render(snapshot);
      });
      room.onMessage("inventory:error", (message) => {
        if (room !== boundRoom) return;
        pending = false;
        showSelection();
        title.textContent = "Инвентарь";
        description.textContent = message;
        itemMenu.hidden = false;
        itemMenu.style.left = "16px";
        itemMenu.style.top = "16px";
      });
      room.onReconnect(() => {
        if (room === boundRoom && dialog.open) room.send("inventory:get");
      });
    },
    setPilot(name) {
      pilot.textContent = name;
      toggle.hidden = false;
    },
  };
}
