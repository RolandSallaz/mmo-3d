import {
  CARGO_SIZE, SHIP_SLOTS, canMoveInventoryItem, defaultInventoryDestination, inventoryItemAt,
} from "../shared/inventory.js";

export function createInventory() {
  const cargo = Array(CARGO_SIZE).fill(null);
  ["shield", "scanner", "alloy", "pulse", "ion"].forEach((item, index) => { cargo[index] = item; });
  const equipment = Object.fromEntries(SHIP_SLOTS.map(({ id }) => [id, id === "engine" ? "engine" : null]));
  const inventory = { cargo, equipment };
  upgradeInventory(inventory);
  return inventory;
}

export function upgradeInventory(inventory) {
  let changed = false;
  for (const { id } of SHIP_SLOTS) {
    if (Object.hasOwn(inventory.equipment, id)) continue;
    inventory.equipment[id] = null;
    changed = true;
  }
  if (inventory.launcherGranted) return changed;
  const cell = inventory.cargo.indexOf(null);
  if (cell < 0) return changed;
  inventory.cargo[cell] = "missile";
  inventory.launcherGranted = true;
  return true;
}

export function moveInventoryItem(inventory, source, requestedDestination) {
  const destination = requestedDestination === undefined
    ? defaultInventoryDestination(inventory, source)
    : requestedDestination;
  if (!canMoveInventoryItem(inventory, source, destination)) return false;

  const item = inventoryItemAt(inventory, source);
  const swapped = inventoryItemAt(inventory, destination);
  const sourceSlots = typeof source === "number" ? inventory.cargo : inventory.equipment;
  const destinationSlots = typeof destination === "number" ? inventory.cargo : inventory.equipment;
  sourceSlots[source] = swapped;
  destinationSlots[destination] = item;
  return true;
}
