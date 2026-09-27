// Cloudflare Pages Function for /api/shop-status
// GET  -> public, tells the customer page whether the shop is currently
//         taking orders ("abierto") or not ("cerrado"). Defaults to
//         "abierto" the first time this ever runs (before anyone in the
//         admin panel has touched the toggle).
// POST -> admin-only, flips that value from the panel's "Abierto/Cerrado"
//         button.
//
// This is what keeps a Mercado Pago payment (or a WhatsApp order) from
// coming in while nobody is at the local to prepare it: both
// functions/api/orders.js and functions/api/create-preference.js check
// this same table before accepting a new order.
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

export async function onRequestGet(context) {
  const { env } = context;
  try {
    await ensureSchema(env.DB);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'shop_status'").first();
    const status = row && row.value === "cerrado" ? "cerrado" : "abierto";
    return json({ status });
  } catch (err) {
    // Si algo falla acá, mejor no bloquear el sitio entero — se asume abierto.
    return json({ status: "abierto" });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!isAdmin(request, env)) return json({ error: "no autorizado" }, 401);
    await ensureSchema(env.DB);
    const body = await request.json().catch(() => ({}));
    const status = body.status === "cerrado" ? "cerrado" : "abierto";
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('shop_status', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(status).run();
    return json({ status });
  } catch (err) {
    return json({ error: "error interno", detail: String((err && err.message) || err) }, 500);
  }
}
