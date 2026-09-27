// Cloudflare Pages Function for /api/products-visibility
// GET  -> public, returns the ids of products the shop has marked as
//         "oculto" (out of stock / not offered right now) — [] means every
//         product on the menu shows normally.
// POST -> admin-only, flips ONE product's visibility on/off from the
//         panel's "Productos" tab.
//
// Reuses the same "settings" key/value table as shop-status.js — one row,
// key 'hidden_products', value a JSON array of product ids. No new table
// beyond what every other function file already creates.
//
// Self-contained on purpose (no shared imports) — see functions/api/orders.js
// for why.

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function isAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return !!env.ADMIN_KEY && key === env.ADMIN_KEY;
}

async function ensureSchema(db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS settings (" +
      "key TEXT PRIMARY KEY, " +
      "value TEXT NOT NULL" +
      ");"
  );
}

async function readHidden(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'hidden_products'").first();
  if (!row) return [];
  try {
    const arr = JSON.parse(row.value);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    await ensureSchema(env.DB);
    const hidden = await readHidden(env.DB);
    return json({ hidden });
  } catch (err) {
    // Si algo falla acá, mejor mostrar el menú completo que romper la página.
    return json({ hidden: [] });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!isAdmin(request, env)) return json({ error: "no autorizado" }, 401);
    await ensureSchema(env.DB);
    const body = await request.json().catch(() => ({}));
    const id = body.id;
    if (!id || typeof id !== "string") return json({ error: "id requerido" }, 400);

    const hidden = await readHidden(env.DB);
    const idx = hidden.indexOf(id);
    if (body.hidden) {
      if (idx === -1) hidden.push(id);
    } else if (idx !== -1) {
      hidden.splice(idx, 1);
    }

    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('hidden_products', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(JSON.stringify(hidden)).run();

    return json({ hidden });
  } catch (err) {
    return json({ error: "error interno", detail: String((err && err.message) || err) }, 500);
  }
}
