import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;
const app = express();

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL in environment");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Database unavailable" });
  }
});

app.post("/api/users/upsert", async (req, res) => {
  const { spotify_id, display_name, email } = req.body;

  if (!spotify_id) {
    return res.status(400).json({ error: "spotify_id is required" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO users (spotify_id, display_name, email)
      VALUES ($1, $2, $3)
      ON CONFLICT (spotify_id)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        email = EXCLUDED.email
      RETURNING id, spotify_id, display_name, email, created_at
      `,
      [spotify_id, display_name ?? null, email ?? null]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("upsert user error", error);
    return res.status(500).json({ error: "Failed to upsert user" });
  }
});

app.post("/api/ratings", async (req, res) => {
  const { user_id, album_id, rating } = req.body;

  if (!user_id || !album_id || typeof rating !== "number") {
    return res.status(400).json({ error: "user_id, album_id, and numeric rating are required" });
  }

  if (rating < 1 || rating > 10) {
    return res.status(400).json({ error: "rating must be between 1 and 10" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO ratings (user_id, album_id, rating)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, album_id)
      DO UPDATE SET rating = EXCLUDED.rating
      RETURNING id, user_id, album_id, rating, created_at
      `,
      [user_id, album_id, rating]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("create rating error", error);
    return res.status(500).json({ error: "Failed to save rating" });
  }
});

app.get("/api/ratings/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  if (Number.isNaN(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, user_id, album_id, rating, created_at
      FROM ratings
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("get ratings error", error);
    return res.status(500).json({ error: "Failed to fetch ratings" });
  }
});

app.post("/api/lists", async (req, res) => {
  const { user_id, name } = req.body;

  if (!user_id || !name) {
    return res.status(400).json({ error: "user_id and name are required" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO lists (user_id, name)
      VALUES ($1, $2)
      RETURNING id, user_id, name, created_at
      `,
      [user_id, name]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("create list error", error);
    return res.status(500).json({ error: "Failed to create list" });
  }
});

app.post("/api/lists/:id/items", async (req, res) => {
  const listId = Number(req.params.id);
  const { album_id, album_name, artist_name } = req.body;

  if (Number.isNaN(listId)) {
    return res.status(400).json({ error: "Invalid list id" });
  }

  if (!album_id || !album_name) {
    return res.status(400).json({ error: "album_id and album_name are required" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO list_items (list_id, album_id, album_name, artist_name)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (list_id, album_id)
      DO UPDATE SET
        album_name = EXCLUDED.album_name,
        artist_name = EXCLUDED.artist_name
      RETURNING id, list_id, album_id, album_name, artist_name, added_at
      `,
      [listId, album_id, album_name, artist_name ?? null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("add list item error", error);
    return res.status(500).json({ error: "Failed to add item to list" });
  }
});

app.get("/api/lists/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  if (Number.isNaN(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    const listsResult = await pool.query(
      `
      SELECT id, user_id, name, created_at
      FROM lists
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    const listIds = listsResult.rows.map((list) => list.id);

    if (listIds.length === 0) {
      return res.json([]);
    }

    const itemsResult = await pool.query(
      `
      SELECT id, list_id, album_id, album_name, artist_name, added_at
      FROM list_items
      WHERE list_id = ANY($1::int[])
      ORDER BY added_at DESC
      `,
      [listIds]
    );

    const itemsByListId = itemsResult.rows.reduce((acc, item) => {
      if (!acc[item.list_id]) {
        acc[item.list_id] = [];
      }
      acc[item.list_id].push(item);
      return acc;
    }, {});

    const response = listsResult.rows.map((list) => ({
      ...list,
      items: itemsByListId[list.id] || [],
    }));

    return res.json(response);
  } catch (error) {
    console.error("get lists error", error);
    return res.status(500).json({ error: "Failed to fetch lists" });
  }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
