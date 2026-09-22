// Cloudflare Pages Function for /api/orders
// GET  -> admin-only, lists all orders (newest first)
// POST -> public, creates a new order and returns its sequential number
//
// Everything this file needs is kept self-contained (no shared imports)
// so there is nothing extra to configure — Cloudflare just needs this one
// file plus a D1 database bound as "DB" in the project's settings.

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
    "CREATE TABLE IF NOT EXISTS orders (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "created_at TEXT NOT NULL, " +
      "items TEXT NOT NULL, " +
      "subtotal INTEGER NOT NULL, " +
      "customer_name TEXT NOT NULL, " +
      "customer_phone TEXT NOT NULL, " +
      "delivery_method TEXT NOT NULL, " +
      "barrio TEXT, " +
      "lat REAL, " +
      "lng REAL, " +
      "distance_km REAL, " +
      "delivery_fee INTEGER, " +
      "total INTEGER NOT NULL, " +
      "notes TEXT, " +
      "address_notes TEXT, " +
      "status TEXT NOT NULL DEFAULT 'preparando'" +
      ");"
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    await ensureSchema(env.DB);
    const body = await request.json().catch(() => ({}));
    const {
      items, subtotal, customerName, customerPhone, deliveryMethod, barrio, lat, lng,
      distanceKm, deliveryFee, total, notes, addressNotes,
    } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: "items requerido" }, 400);
    }
    if (typeof total !== "number") {
      return json({ error: "total requerido" }, 400);
    }
    // Nombre y teléfono son el respaldo para ubicar al cliente si el mensaje
    // de WhatsApp no llega — se piden siempre, no solo para delivery.
    if (!customerName || !String(customerName).trim()) {
      return json({ error: "nombre requerido" }, 400);
    }
    if (!customerPhone || !String(customerPhone).trim()) {
      return json({ error: "teléfono requerido" }, 400);
    }
    // No se manda más el link con las coordenadas, así que en delivery la
    // dirección exacta es la única forma de saber dónde entregar.
    if ((deliveryMethod || "pickup") === "delivery" && (!addressNotes || !String(addressNotes).trim())) {
      return json({ error: "dirección exacta requerida para delivery" }, 400);
    }

    const createdAt = new Date().toISOString();

    const result = await env.DB.prepare(
      "INSERT INTO orders (created_at, items, subtotal, customer_name, customer_phone, delivery_method, barrio, lat, lng, distance_km, delivery_fee, total, notes, address_notes, status) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparando')"
    ).bind(
      createdAt,
      JSON.stringify(items),
      subtotal || 0,
      String(customerName).trim(),
      String(customerPhone).trim(),
      deliveryMethod || "pickup",
      barrio || null,
      lat ?? null,
      lng ?? null,
      distanceKm ?? null,
      deliveryFee ?? null,
      total,
      notes || null,
      addressNotes || null
    ).run();

    return json({ orderNumber: result.meta.last_row_id, createdAt }, 201);
  } catch (err) {
    return json({ error: "error interno", detail: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    if (!isAdmin(request, env)) return json({ error: "no autorizado" }, 401);
    await ensureSchema(env.DB);
    const { results } = await env.DB.prepare(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT 200"
    ).all();
    const orders = (results || []).map((row) => ({ ...row, items: JSON.parse(row.items) }));
    return json({ orders });
  } catch (err) {
    return json({ error: "error interno", detail: String((err && err.message) || err) }, 500);
  }
}
