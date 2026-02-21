import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
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

const tokenSecret = process.env.TOKEN_SECRET || "dev-token-secret-change-me";
const tokenLifetimeMs = 1000 * 60 * 60 * 24 * 7;

function base64UrlEncode(value) {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(source)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64").toString("utf8");
}

function signToken(payload) {
  const header = base64UrlEncode({ alg: "HS256", typ: "JWT" });
  const now = Date.now();
  const body = base64UrlEncode({ ...payload, iat: now, exp: now + tokenLifetimeMs });
  const unsignedToken = `${header}.${body}`;
  const signature = crypto
    .createHmac("sha256", tokenSecret)
    .update(unsignedToken)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsignedToken}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const [header, payload, signature] = parts;
  const unsignedToken = `${header}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", tokenSecret)
    .update(unsignedToken)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const signatureMatches = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );

  if (!signatureMatches) {
    throw new Error("Invalid token signature");
  }

  const decodedPayload = JSON.parse(base64UrlDecode(payload));
  if (!decodedPayload.exp || decodedPayload.exp < Date.now()) {
    throw new Error("Token expired");
  }

  return decodedPayload;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const derivedHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(derivedHash));
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const payload = verifyToken(token);
    req.appUserId = Number(payload.sub);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid auth token" });
  }
}

async function getLinkedSpotifyUserId(appUserId) {
  const result = await pool.query(
    "SELECT spotify_user_id FROM app_users WHERE id = $1",
    [appUserId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].spotify_user_id;
}

async function ensureCoreTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      spotify_user_id INT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      spotify_refresh_token TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS spotify_refresh_token TEXT
  `);

  await pool.query(`
    ALTER TABLE list_items
    ADD COLUMN IF NOT EXISTS item_type TEXT
  `);

  await pool.query(`
    ALTER TABLE list_items
    ADD COLUMN IF NOT EXISTS item_id TEXT
  `);

  await pool.query(`
    ALTER TABLE list_items
    ADD COLUMN IF NOT EXISTS item_name TEXT
  `);

  await pool.query(`
    ALTER TABLE list_items
    ADD COLUMN IF NOT EXISTS item_subtitle TEXT
  `);

  await pool.query(`
    ALTER TABLE list_items
    ADD COLUMN IF NOT EXISTS image_url TEXT
  `);

  await pool.query(`
    ALTER TABLE list_items
    ADD COLUMN IF NOT EXISTS position INT
  `);

  await pool.query(`
    UPDATE list_items
    SET
      item_type = COALESCE(item_type, 'album'),
      item_id = COALESCE(item_id, album_id),
      item_name = COALESCE(item_name, album_name),
      item_subtitle = COALESCE(item_subtitle, artist_name),
      position = COALESCE(position, id)
    WHERE
      item_type IS NULL OR
      item_id IS NULL OR
      item_name IS NULL OR
      position IS NULL
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS list_items_unique_item
    ON list_items (list_id, item_type, item_id)
  `);
}

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Database unavailable" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (username.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const passwordHash = hashPassword(password);
    const result = await pool.query(
      `
      INSERT INTO app_users (username, password_hash)
      VALUES ($1, $2)
      RETURNING id, username, spotify_user_id, created_at
      `,
      [username, passwordHash]
    );

    const user = result.rows[0];
    const token = signToken({ sub: user.id });

    return res.status(201).json({ token, user });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Username already exists" });
    }

    console.error("register error", error);
    return res.status(500).json({ error: "Failed to register" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, username, password_hash, spotify_user_id, created_at
      FROM app_users
      WHERE username = $1
      `,
      [username]
    );

    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = signToken({ sub: user.id });
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        spotify_user_id: user.spotify_user_id,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error("login error", error);
    return res.status(500).json({ error: "Failed to login" });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, username, spotify_user_id, created_at
      FROM app_users
      WHERE id = $1
      `,
      [req.appUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("auth me error", error);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

app.post("/api/users/upsert", requireAuth, async (req, res) => {
  const { spotify_id, display_name, email, spotify_refresh_token } = req.body;

  if (!spotify_id) {
    return res.status(400).json({ error: "spotify_id is required" });
  }

  try {
    const spotifyUserResult = await pool.query(
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

    const spotifyUser = spotifyUserResult.rows[0];

    await pool.query(
      `
      UPDATE app_users
      SET spotify_user_id = $1,
          spotify_refresh_token = COALESCE($2, spotify_refresh_token)
      WHERE id = $3
      `,
      [spotifyUser.id, spotify_refresh_token ?? null, req.appUserId]
    );

    return res.json({
      spotify_user_id: spotifyUser.id,
      spotify_user: spotifyUser,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "This Spotify account is already linked" });
    }

    console.error("upsert user error", error);
    return res.status(500).json({ error: "Failed to upsert user" });
  }
});

app.get("/api/spotify/token", requireAuth, async (req, res) => {
  try {
    const appUserResult = await pool.query(
      `
      SELECT spotify_user_id, spotify_refresh_token
      FROM app_users
      WHERE id = $1
      `,
      [req.appUserId]
    );

    const appUser = appUserResult.rows[0];
    if (!appUser?.spotify_user_id) {
      return res.status(400).json({ error: "Link Spotify account first" });
    }

    if (!appUser.spotify_refresh_token) {
      return res.status(400).json({ error: "Spotify refresh token missing. Re-link Spotify." });
    }

    const refreshResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.SPOTIFY_CLIENT_ID || "52ef8393bb03454a8d33998beacb0927",
        grant_type: "refresh_token",
        refresh_token: appUser.spotify_refresh_token,
      }),
    });

    if (!refreshResponse.ok) {
      return res.status(401).json({ error: "Failed to refresh Spotify session. Re-link Spotify." });
    }

    const tokenData = await refreshResponse.json();
    if (!tokenData.access_token) {
      return res.status(401).json({ error: "Invalid Spotify refresh response" });
    }

    if (tokenData.refresh_token) {
      await pool.query(
        `
        UPDATE app_users
        SET spotify_refresh_token = $1
        WHERE id = $2
        `,
        [tokenData.refresh_token, req.appUserId]
      );
    }

    return res.json({ access_token: tokenData.access_token });
  } catch (error) {
    console.error("spotify token error", error);
    return res.status(500).json({ error: "Failed to get Spotify token" });
  }
});

app.post("/api/ratings", requireAuth, async (req, res) => {
  const { album_id, rating } = req.body;

  if (!album_id || typeof rating !== "number") {
    return res.status(400).json({ error: "album_id and numeric rating are required" });
  }

  if (rating < 1 || rating > 10) {
    return res.status(400).json({ error: "rating must be between 1 and 10" });
  }

  try {
    const spotifyUserId = await getLinkedSpotifyUserId(req.appUserId);
    if (!spotifyUserId) {
      return res.status(400).json({ error: "Link Spotify before rating albums" });
    }

    const result = await pool.query(
      `
      INSERT INTO ratings (user_id, album_id, rating)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, album_id)
      DO UPDATE SET rating = EXCLUDED.rating
      RETURNING id, user_id, album_id, rating, created_at
      `,
      [spotifyUserId, album_id, rating]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("create rating error", error);
    return res.status(500).json({ error: "Failed to save rating" });
  }
});

app.get("/api/ratings", requireAuth, async (req, res) => {
  try {
    const spotifyUserId = await getLinkedSpotifyUserId(req.appUserId);
    if (!spotifyUserId) {
      return res.json([]);
    }

    const result = await pool.query(
      `
      SELECT id, user_id, album_id, rating, created_at
      FROM ratings
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [spotifyUserId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("get ratings error", error);
    return res.status(500).json({ error: "Failed to fetch ratings" });
  }
});

app.post("/api/lists", requireAuth, async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const spotifyUserId = await getLinkedSpotifyUserId(req.appUserId);
    if (!spotifyUserId) {
      return res.status(400).json({ error: "Link Spotify before creating lists" });
    }

    const result = await pool.query(
      `
      INSERT INTO lists (user_id, name)
      VALUES ($1, $2)
      RETURNING id, user_id, name, created_at
      `,
      [spotifyUserId, name]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("create list error", error);
    return res.status(500).json({ error: "Failed to create list" });
  }
});

app.post("/api/lists/:id/items", requireAuth, async (req, res) => {
  const listId = Number(req.params.id);
  const { item_type, item_id, item_name, item_subtitle, image_url } = req.body;

  if (Number.isNaN(listId)) {
    return res.status(400).json({ error: "Invalid list id" });
  }

  if (!item_type || !item_id || !item_name) {
    return res.status(400).json({ error: "item_type, item_id, and item_name are required" });
  }

  if (!["album", "track", "artist"].includes(item_type)) {
    return res.status(400).json({ error: "item_type must be one of album, track, artist" });
  }

  try {
    const spotifyUserId = await getLinkedSpotifyUserId(req.appUserId);
    if (!spotifyUserId) {
      return res.status(400).json({ error: "Link Spotify before adding list items" });
    }

    const ownerResult = await pool.query(
      "SELECT id FROM lists WHERE id = $1 AND user_id = $2",
      [listId, spotifyUserId]
    );

    if (ownerResult.rows.length === 0) {
      return res.status(403).json({ error: "You do not have access to this list" });
    }

    const positionResult = await pool.query(
      "SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM list_items WHERE list_id = $1",
      [listId]
    );

    const nextPosition = positionResult.rows[0]?.next_position || 1;

    const result = await pool.query(
      `
      INSERT INTO list_items (
        list_id, item_type, item_id, item_name, item_subtitle, image_url, position,
        album_id, album_name, artist_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $3, $4, $5)
      ON CONFLICT (list_id, item_type, item_id)
      DO UPDATE SET
        item_name = EXCLUDED.item_name,
        item_subtitle = EXCLUDED.item_subtitle,
        image_url = EXCLUDED.image_url,
        album_name = EXCLUDED.item_name,
        artist_name = EXCLUDED.item_subtitle
      RETURNING
        id, list_id, item_type, item_id, item_name, item_subtitle, image_url, position, added_at
      `,
      [listId, item_type, item_id, item_name, item_subtitle ?? null, image_url ?? null, nextPosition]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("add list item error", error);
    return res.status(500).json({ error: "Failed to add item to list" });
  }
});

app.patch("/api/lists/:id/items/reorder", requireAuth, async (req, res) => {
  const listId = Number(req.params.id);
  const { ordered_item_ids } = req.body;

  if (Number.isNaN(listId)) {
    return res.status(400).json({ error: "Invalid list id" });
  }

  if (!Array.isArray(ordered_item_ids) || ordered_item_ids.length === 0) {
    return res.status(400).json({ error: "ordered_item_ids must be a non-empty array" });
  }

  try {
    const spotifyUserId = await getLinkedSpotifyUserId(req.appUserId);
    if (!spotifyUserId) {
      return res.status(400).json({ error: "Link Spotify before reordering list items" });
    }

    const ownerResult = await pool.query(
      "SELECT id FROM lists WHERE id = $1 AND user_id = $2",
      [listId, spotifyUserId]
    );

    if (ownerResult.rows.length === 0) {
      return res.status(403).json({ error: "You do not have access to this list" });
    }

    await pool.query("BEGIN");

    for (let i = 0; i < ordered_item_ids.length; i += 1) {
      const itemId = Number(ordered_item_ids[i]);
      if (Number.isNaN(itemId)) continue;

      await pool.query(
        `
        UPDATE list_items
        SET position = $1
        WHERE id = $2 AND list_id = $3
        `,
        [i + 1, itemId, listId]
      );
    }

    await pool.query("COMMIT");

    const itemsResult = await pool.query(
      `
      SELECT
        id, list_id, item_type, item_id, item_name, item_subtitle, image_url, position, added_at
      FROM list_items
      WHERE list_id = $1
      ORDER BY position ASC, added_at ASC
      `,
      [listId]
    );

    return res.json({ items: itemsResult.rows });
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("reorder list items error", error);
    return res.status(500).json({ error: "Failed to reorder list items" });
  }
});

app.get("/api/lists", requireAuth, async (req, res) => {
  try {
    const spotifyUserId = await getLinkedSpotifyUserId(req.appUserId);
    if (!spotifyUserId) {
      return res.json([]);
    }

    const listsResult = await pool.query(
      `
      SELECT id, user_id, name, created_at
      FROM lists
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [spotifyUserId]
    );

    const listIds = listsResult.rows.map((list) => list.id);

    if (listIds.length === 0) {
      return res.json([]);
    }

    const itemsResult = await pool.query(
      `
      SELECT
        id, list_id, item_type, item_id, item_name, item_subtitle, image_url, position, added_at
      FROM list_items
      WHERE list_id = ANY($1::int[])
      ORDER BY position ASC, added_at ASC
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

ensureCoreTables()
  .then(() => {
    app.listen(port, () => {
      console.log(`API listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start API", error);
    process.exit(1);
  });
