import { Pool } from "pg";
import { createInventory, moveInventoryItem } from "./inventory.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DATABASE_URL before starting the game server.");

const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("Inventory database connection:", error.message));

export async function initializeInventoryStore() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_inventory (
      character_id text PRIMARY KEY,
      nickname text NOT NULL,
      inventory jsonb NOT NULL,
      revision integer NOT NULL DEFAULT 0
    )
  `);
}

export async function loadCharacter(characterId, nickname) {
  await pool.query(`
    INSERT INTO player_inventory (character_id, nickname, inventory)
    VALUES ($1, $2, $3) ON CONFLICT (character_id) DO NOTHING
  `, [characterId, nickname, createInventory()]);
  const { rows: [row] } = await pool.query(
    "SELECT nickname, inventory, revision FROM player_inventory WHERE character_id = $1", [characterId],
  );
  return { nickname: row.nickname, equipment: row.inventory.equipment, revision: row.revision };
}

export async function getInventory(characterId) {
  const { rows: [row] } = await pool.query(
    "SELECT inventory, revision FROM player_inventory WHERE character_id = $1", [characterId],
  );
  return { ...row.inventory, revision: row.revision };
}

export async function applyInventoryMove(characterId, message) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [row] } = await client.query(
      "SELECT inventory, revision FROM player_inventory WHERE character_id = $1 FOR UPDATE", [characterId],
    );
    const { inventory } = row;
    let { revision } = row;
    if (message?.revision === revision && moveInventoryItem(inventory, message.source, message.destination)) {
      revision++;
      await client.query(
        "UPDATE player_inventory SET inventory = $2, revision = $3 WHERE character_id = $1",
        [characterId, inventory, revision],
      );
    }
    await client.query("COMMIT");
    return { ...inventory, revision };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
