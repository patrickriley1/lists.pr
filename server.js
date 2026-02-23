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
const spotifyClientId = process.env.SPOTIFY_CLIENT_ID || "";
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
const spotifyTokenRefreshBufferMs = 30 * 1000;

let spotifyAppToken = "";
let spotifyAppTokenExpiresAt = 0;

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

async function getSpotifyClientAccessToken() {
  const now = Date.now();
  if (spotifyAppToken && now + spotifyTokenRefreshBufferMs < spotifyAppTokenExpiresAt) {
    return spotifyAppToken;
  }

  if (!spotifyClientId || !spotifyClientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be configured");
  }

  const authHeader = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Failed to fetch Spotify app token");
  }

  spotifyAppToken = data.access_token;
  spotifyAppTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return spotifyAppToken;
}

async function ensureCoreTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS email TEXT
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique_idx
    ON app_users (LOWER(email))
    WHERE email IS NOT NULL
  `);

  await pool.query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS spotify_user_id INT
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

  await pool.query(`
    ALTER TABLE lists
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE lists
    ADD COLUMN IF NOT EXISTS app_user_id INT
  `);

  await pool.query(`
    ALTER TABLE lists
    ALTER COLUMN user_id DROP NOT NULL
  `).catch(() => {});

  await pool.query(`
    UPDATE lists
    SET updated_at = COALESCE(updated_at, created_at, NOW())
    WHERE updated_at IS NULL
  `);

  await pool.query(`
    UPDATE lists AS l
    SET app_user_id = au.id
    FROM app_users AS au
    WHERE l.app_user_id IS NULL
      AND au.spotify_user_id IS NOT NULL
      AND l.user_id = au.spotify_user_id
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS lists_app_user_id_idx
    ON lists (app_user_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS lists_owner_sort_idx
    ON lists (app_user_id, updated_at DESC, created_at DESC)
    WHERE app_user_id IS NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ratings (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      album_id TEXT,
      item_type TEXT DEFAULT 'album',
      item_id TEXT,
      rating INT NOT NULL,
      review_title TEXT,
      review_body TEXT,
      item_name TEXT,
      item_subtitle TEXT,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE ratings
    ALTER COLUMN album_id DROP NOT NULL
  `).catch(() => {});

  await pool.query(`
    ALTER TABLE ratings
    ADD COLUMN IF NOT EXISTS app_user_id INT
  `);

  await pool.query(`
    ALTER TABLE ratings
    ALTER COLUMN user_id DROP NOT NULL
  `).catch(() => {});

  await pool.query(`
    ALTER TABLE ratings
    ADD COLUMN IF NOT EXISTS item_type TEXT
  `);

  await pool.query(`
    ALTER TABLE ratings
    ADD COLUMN IF NOT EXISTS item_id TEXT
  `);

  await pool.query(`
    ALTER TABLE ratings
    ADD COLUMN IF NOT EXISTS review_title TEXT
  `);

  await pool.query(`
    ALTER TABLE ratings
    ADD COLUMN IF NOT EXISTS review_body TEXT
  `);

  await pool.query(`
    ALTER TABLE ratings
    ADD COLUMN IF NOT EXISTS item_name TEXT
  `);

  await pool.query(`
    ALTER TABLE ratings
    ADD COLUMN IF NOT EXISTS item_subtitle TEXT
  `);

  await pool.query(`
    ALTER TABLE ratings
    ADD COLUMN IF NOT EXISTS image_url TEXT
  `);

  await pool.query(`
    ALTER TABLE ratings
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    UPDATE ratings
    SET
      item_type = COALESCE(item_type, 'album'),
      item_id = COALESCE(item_id, album_id),
      album_id = COALESCE(album_id, item_id),
      updated_at = COALESCE(updated_at, created_at, NOW())
    WHERE item_type IS NULL OR item_id IS NULL OR album_id IS NULL OR updated_at IS NULL
  `);

  await pool.query(`
    UPDATE ratings AS r
    SET app_user_id = au.id
    FROM app_users AS au
    WHERE r.app_user_id IS NULL
      AND au.spotify_user_id IS NOT NULL
      AND r.user_id = au.spotify_user_id
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ratings_unique_item
    ON ratings (user_id, item_type, item_id)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ratings_unique_item_app_user
    ON ratings (app_user_id, item_type, item_id)
    WHERE app_user_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ratings_owner_sort_idx
    ON ratings (app_user_id, updated_at DESC, created_at DESC)
    WHERE app_user_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS list_items_list_position_idx
    ON list_items (list_id, position ASC, added_at ASC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listen_later (
      id SERIAL PRIMARY KEY,
      app_user_id INT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_subtitle TEXT,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS listen_later_unique_item
    ON listen_later (app_user_id, item_type, item_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS listen_later_owner_sort_idx
    ON listen_later (app_user_id, created_at DESC)
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
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (username.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "A valid email is required" });
  }

  try {
    const passwordHash = hashPassword(password);
    const result = await pool.query(
      `
      INSERT INTO app_users (username, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, username, email, created_at
      `,
      [username, email, passwordHash]
    );

    const user = result.rows[0];
    const token = signToken({ sub: user.id });

    return res.status(201).json({ token, user });
  } catch (error) {
    if (error.code === "23505") {
      const detail = String(error.detail || "").toLowerCase();
      if (detail.includes("email")) {
        return res.status(409).json({ error: "Email already exists" });
      }
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
      SELECT id, username, email, password_hash, created_at
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
        email: user.email,
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
      SELECT id, username, email, created_at
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

app.get("/api/spotify/token", requireAuth, async (_req, res) => {
  try {
    const accessToken = await getSpotifyClientAccessToken();
    const remainingSeconds = Math.max(0, Math.floor((spotifyAppTokenExpiresAt - Date.now()) / 1000));
    return res.json({ access_token: accessToken, expires_in: remainingSeconds });
  } catch (error) {
    console.error("spotify token error", error);
    return res.status(500).json({ error: "Failed to get Spotify token" });
  }
});

app.get("/api/listen-later", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, app_user_id, item_type, item_id, item_name, item_subtitle, image_url, created_at
      FROM listen_later
      WHERE app_user_id = $1
      ORDER BY created_at DESC, id DESC
      `,
      [req.appUserId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("get listen later error", error);
    return res.status(500).json({ error: "Failed to fetch listen later items" });
  }
});

app.post("/api/listen-later", requireAuth, async (req, res) => {
  const itemType = String(req.body.item_type || "").trim();
  const itemId = String(req.body.item_id || "").trim();
  const itemName = String(req.body.item_name || "").trim();
  const itemSubtitle = typeof req.body.item_subtitle === "string" ? req.body.item_subtitle.trim() : "";
  const imageUrl = typeof req.body.image_url === "string" ? req.body.image_url.trim() : "";

  if (!["album", "track"].includes(itemType) || !itemId || !itemName) {
    return res.status(400).json({ error: "item_type, item_id, and item_name are required" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO listen_later (app_user_id, item_type, item_id, item_name, item_subtitle, image_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (app_user_id, item_type, item_id)
      DO UPDATE SET
        item_name = EXCLUDED.item_name,
        item_subtitle = EXCLUDED.item_subtitle,
        image_url = EXCLUDED.image_url
      RETURNING id, app_user_id, item_type, item_id, item_name, item_subtitle, image_url, created_at
      `,
      [req.appUserId, itemType, itemId, itemName, itemSubtitle || null, imageUrl || null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("create listen later error", error);
    return res.status(500).json({ error: "Failed to save listen later item" });
  }
});

app.delete("/api/listen-later/:id", requireAuth, async (req, res) => {
  const itemRowId = Number(req.params.id);
  if (Number.isNaN(itemRowId)) {
    return res.status(400).json({ error: "Invalid listen later item id" });
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM listen_later
      WHERE id = $1 AND app_user_id = $2
      RETURNING id
      `,
      [itemRowId, req.appUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Listen later item not found" });
    }

    return res.status(204).send();
  } catch (error) {
    console.error("delete listen later error", error);
    return res.status(500).json({ error: "Failed to delete listen later item" });
  }
});

app.post("/api/ratings", requireAuth, async (req, res) => {
  const rawItemType = String(req.body.item_type || "").trim();
  const itemType = rawItemType || (req.body.album_id ? "album" : "");
  const itemId = String(req.body.item_id || req.body.album_id || "").trim();
  const rating = Number(req.body.rating);
  const reviewTitle = typeof req.body.review_title === "string" ? req.body.review_title.trim() : "";
  const reviewBody = typeof req.body.review_body === "string" ? req.body.review_body.trim() : "";
  const itemName = typeof req.body.item_name === "string" ? req.body.item_name.trim() : "";
  const itemSubtitle = typeof req.body.item_subtitle === "string" ? req.body.item_subtitle.trim() : "";
  const imageUrl = typeof req.body.image_url === "string" ? req.body.image_url.trim() : "";

  if (!["album", "track", "artist"].includes(itemType) || !itemId || Number.isNaN(rating)) {
    return res.status(400).json({ error: "item_type, item_id, and numeric rating are required" });
  }

  if (rating < 1 || rating > 10) {
    return res.status(400).json({ error: "rating must be between 1 and 10" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO ratings (
        app_user_id, user_id, album_id, item_type, item_id, rating, review_title, review_body, item_name, item_subtitle, image_url, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (app_user_id, item_type, item_id) WHERE app_user_id IS NOT NULL
      DO UPDATE SET
        rating = EXCLUDED.rating,
        review_title = EXCLUDED.review_title,
        review_body = EXCLUDED.review_body,
        item_name = EXCLUDED.item_name,
        item_subtitle = EXCLUDED.item_subtitle,
        image_url = EXCLUDED.image_url,
        user_id = EXCLUDED.user_id,
        updated_at = NOW()
      RETURNING
        id, app_user_id, user_id, album_id, item_type, item_id, rating, review_title, review_body, item_name, item_subtitle, image_url, created_at, updated_at
      `,
      [
        req.appUserId,
        null,
        itemType === "album" ? itemId : null,
        itemType,
        itemId,
        rating,
        reviewTitle || null,
        reviewBody || null,
        itemName || null,
        itemSubtitle || null,
        imageUrl || null,
      ]
    );

    await pool.query(
      `
      DELETE FROM listen_later
      WHERE app_user_id = $1 AND item_type = $2 AND item_id = $3
      `,
      [req.appUserId, itemType, itemId]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("create rating error", error);
    return res.status(500).json({ error: "Failed to save rating" });
  }
});

app.get("/api/ratings", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id, app_user_id, user_id, album_id, item_type, item_id, rating, review_title, review_body, item_name, item_subtitle, image_url, created_at, updated_at
      FROM ratings
      WHERE app_user_id = $1
      ORDER BY updated_at DESC, created_at DESC
      `,
      [req.appUserId]
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
    const result = await pool.query(
      `
      INSERT INTO lists (app_user_id, user_id, name, updated_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING id, app_user_id, user_id, name, created_at, updated_at
      `,
      [req.appUserId, null, name]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("create list error", error);
    return res.status(500).json({ error: "Failed to create list" });
  }
});

app.patch("/api/lists/:id", requireAuth, async (req, res) => {
  const listId = Number(req.params.id);
  const name = String(req.body.name || "").trim();

  if (Number.isNaN(listId)) {
    return res.status(400).json({ error: "Invalid list id" });
  }

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE lists
      SET name = $1, updated_at = NOW()
      WHERE id = $2 AND app_user_id = $3
      RETURNING id, app_user_id, user_id, name, created_at, updated_at
      `,
      [name, listId, req.appUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "List not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("edit list error", error);
    return res.status(500).json({ error: "Failed to edit list" });
  }
});

app.delete("/api/lists/:id", requireAuth, async (req, res) => {
  const listId = Number(req.params.id);

  if (Number.isNaN(listId)) {
    return res.status(400).json({ error: "Invalid list id" });
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM lists
      WHERE id = $1 AND app_user_id = $2
      RETURNING id
      `,
      [listId, req.appUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "List not found" });
    }

    return res.status(204).send();
  } catch (error) {
    console.error("delete list error", error);
    return res.status(500).json({ error: "Failed to delete list" });
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
    const ownerResult = await pool.query(
      "SELECT id FROM lists WHERE id = $1 AND app_user_id = $2",
      [listId, req.appUserId]
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

    await pool.query("UPDATE lists SET updated_at = NOW() WHERE id = $1", [listId]);

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("add list item error", error);
    return res.status(500).json({ error: "Failed to add item to list" });
  }
});

app.delete("/api/lists/:id/items/:itemId", requireAuth, async (req, res) => {
  const listId = Number(req.params.id);
  const listItemId = Number(req.params.itemId);

  if (Number.isNaN(listId) || Number.isNaN(listItemId)) {
    return res.status(400).json({ error: "Invalid list id or item id" });
  }

  try {
    const ownerResult = await pool.query(
      "SELECT id FROM lists WHERE id = $1 AND app_user_id = $2",
      [listId, req.appUserId]
    );

    if (ownerResult.rows.length === 0) {
      return res.status(403).json({ error: "You do not have access to this list" });
    }

    const deleteResult = await pool.query(
      `
      DELETE FROM list_items
      WHERE id = $1 AND list_id = $2
      RETURNING id
      `,
      [listItemId, listId]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: "List item not found" });
    }

    await pool.query(
      `
      WITH ordered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, added_at ASC) AS next_position
        FROM list_items
        WHERE list_id = $1
      )
      UPDATE list_items AS li
      SET position = ordered.next_position
      FROM ordered
      WHERE li.id = ordered.id
      `,
      [listId]
    );

    await pool.query("UPDATE lists SET updated_at = NOW() WHERE id = $1", [listId]);

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
    console.error("delete list item error", error);
    return res.status(500).json({ error: "Failed to delete list item" });
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

  const client = await pool.connect();
  try {
    const ownerResult = await client.query(
      "SELECT id FROM lists WHERE id = $1 AND app_user_id = $2",
      [listId, req.appUserId]
    );

    if (ownerResult.rows.length === 0) {
      return res.status(403).json({ error: "You do not have access to this list" });
    }

    await client.query("BEGIN");

    for (let i = 0; i < ordered_item_ids.length; i += 1) {
      const itemId = Number(ordered_item_ids[i]);
      if (Number.isNaN(itemId)) continue;

      await client.query(
        `
        UPDATE list_items
        SET position = $1
        WHERE id = $2 AND list_id = $3
        `,
        [i + 1, itemId, listId]
      );
    }

    await client.query("UPDATE lists SET updated_at = NOW() WHERE id = $1", [listId]);
    await client.query("COMMIT");

    const itemsResult = await client.query(
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
    await client.query("ROLLBACK").catch(() => {});
    console.error("reorder list items error", error);
    return res.status(500).json({ error: "Failed to reorder list items" });
  } finally {
    client.release();
  }
});

app.get("/api/lists", requireAuth, async (req, res) => {
  try {
    const listsResult = await pool.query(
      `
      SELECT id, app_user_id, user_id, name, created_at, updated_at
      FROM lists
      WHERE app_user_id = $1
      ORDER BY updated_at DESC, created_at DESC
      `,
      [req.appUserId]
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
