import { ENGINE_MODELS, LASER_MODELS, SHIELD_MODELS } from "./equipment.js";

export const CARGO_SIZE = 24;

export const SHIP_SLOTS = [
  { id: "engine", type: "engine", name: "Двигатель", icon: "engine" },
  { id: "shield", type: "shield", name: "Щит", icon: "shield" },
  { id: "module", type: "module", name: "Модуль", icon: "scanner" },
  { id: "weapon-left", type: "weapon", name: "Левое оружие", icon: "pulse" },
  { id: "weapon-right", type: "weapon", name: "Правое оружие", icon: "pulse" },
];

export const ITEMS = {
  engine: { ...ENGINE_MODELS.engine, slot: "engine", description: "Ионный двигатель для маневрирования и перелётов." },
  shield: { ...SHIELD_MODELS.shield, slot: "shield", description: "Генератор сферического энергетического поля вокруг корпуса." },
  scanner: { name: "Сканер сектора", slot: "module", description: "Бортовой модуль для исследования пространства." },
  alloy: { name: "Титановый сплав", description: "Материал для ремонта и производства." },
  pulse: { ...LASER_MODELS.pulse, slot: "weapon", description: "Импульсная лазерная пушка. Дальность 430 ед. Урон 18. Перезарядка 0,39 с." },
  ion: { ...LASER_MODELS.ion, slot: "weapon", description: "Фиолетовый дальнобойный лазер. Дальность 545 ед. Урон 28. Перезарядка 0,65 с." },
};

function shipSlot(position) {
  return SHIP_SLOTS.find(({ id }) => id === position);
}

export function inventoryItemAt(inventory, position) {
  if (!inventory) return undefined;
  if (Number.isInteger(position)) return inventory.cargo[position];
  if (shipSlot(position)) return inventory.equipment[position];
}

function fits(position, item) {
  return Number.isInteger(position) || item === null || shipSlot(position)?.type === ITEMS[item]?.slot;
}

export function canMoveInventoryItem(inventory, source, destination) {
  if (source === destination) return false;
  const item = inventoryItemAt(inventory, source);
  const swapped = inventoryItemAt(inventory, destination);
  return Boolean(item) && swapped !== undefined && fits(destination, item) && fits(source, swapped);
}

export function defaultInventoryDestination(inventory, source) {
  const item = inventoryItemAt(inventory, source);
  if (!item) return undefined;
  if (typeof source === "string") {
    const empty = inventory.cargo.indexOf(null);
    return empty < 0 ? undefined : empty;
  }
  const compatible = SHIP_SLOTS.filter(({ type }) => type === ITEMS[item].slot);
  return (compatible.find(({ id }) => inventory.equipment[id] === null) ?? compatible[0])?.id;
}
