import {
  CARGO_SIZE, SHIP_SLOTS, canMoveInventoryItem, defaultInventoryDestination, inventoryItemAt,
} from "../shared/inventory.js";

export function createInventory() {
  const cargo = Array(CARGO_SIZE).fill(null);
  ["shield", "scanner", "alloy", "pulse", "ion"].forEach((item, index) => { cargo[index] = item; });
  const equipment = Object.fromEntries(SHIP_SLOTS.map(({ id }) => [id, id === "engine" ? "engine" : null]));
  return { cargo, equipment };
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
