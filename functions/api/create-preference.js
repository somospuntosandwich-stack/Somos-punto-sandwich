// Cloudflare Pages Function for /api/create-preference
// POST -> public, called when the customer chooses "Pagar online" (Mercado
// Pago) instead of "Pagar al recibir". It does two things: (1) saves the
// order in D1 exactly like functions/api/orders.js does, but marked as
// payment_method = "mercadopago" / payment_status = "pendiente", and
// (2) asks Mercado Pago to create a checkout ("preferencia") for that
// order's total and hands back the URL to send the customer's browser to.
//
// IMPORTANT: this endpoint does NOT confirm payment — it only starts the
// checkout. The only authoritative confirmation is the webhook in
// functions/api/mp-webhook.js, which Mercado Pago calls on its own once the
// payment actually goes through (or fails), and which is what updates
// payment_status in the database.
//
// Self-contained on purpose (no shared imports) — see functions/api/orders.js
// for why.

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
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
  const paymentColumns = [
    "ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'efectivo'",
    "ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'no_aplica'",
    "ALTER TABLE orders ADD COLUMN mp_preference_id TEXT",
    "ALTER TABLE orders ADD COLUMN mp_payment_id TEXT",
  ];
  for (const stmt of paymentColumns) {
    try {
      await db.exec(stmt);
    } catch (err) {
      // already exists — fine.
    }
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.MP_ACCESS_TOKEN) {
      return json(
        { error: "Mercado Pago no está configurado todavía en este sitio (falta MP_ACCESS_TOKEN)." },
        500
      );
    }

    await ensureSchema(env.DB);
    const body = await request.json().catch(() => ({}));
    const {
      items, subtotal, customerName, customerPhone, deliveryMethod, barrio, lat, lng,
      distanceKm, deliveryFee, total, notes, addressNotes,
    } = body;

    // Same validation as functions/api/orders.js — an online-paid order
    // still needs all the same delivery/contact info as a cash one.
    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: "items requerido" }, 400);
    }
    if (typeof total !== "number" || total <= 0) {
      return json({ error: "total requerido" }, 400);
    }
    if (!customerName || !String(customerName).trim()) {
      return json({ error: "nombre requerido" }, 400);
    }
    if (!customerPhone || !String(customerPhone).trim()) {
      return json({ error: "teléfono requerido" }, 400);
    }
    if ((deliveryMethod || "pickup") === "delivery" && (!addressNotes || !String(addressNotes).trim())) {
      return json({ error: "dirección exacta requerida para delivery" }, 400);
    }

    const createdAt = new Date().toISOString();

    const insertResult = await env.DB.prepare(
      "INSERT INTO orders (created_at, items, subtotal, customer_name, customer_phone, delivery_method, barrio, lat, lng, distance_km, delivery_fee, total, notes, address_notes, status, payment_method, payment_status) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparando', 'mercadopago', 'pendiente')"
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

    const orderId = insertResult.meta.last_row_id;
    const origin = new URL(request.url).origin;

    // One single line item for the whole order (instead of one line per
    // product) — simpler, and avoids any rounding mismatch between the sum
    // of individual items and the total the customer actually agreed to
    // (which already includes the delivery fee for delivery orders).
    const preferenceBody = {
      items: [
        {
          title: "Pedido N° " + orderId + " – Punto Sandwich",
          quantity: 1,
          currency_id: "ARS",
          unit_price: total,
        },
      ],
      external_reference: String(orderId),
      back_urls: {
        success: origin + "/?pago=exito&pedido=" + orderId,
        failure: origin + "/?pago=fallo&pedido=" + orderId,
        pending: origin + "/?pago=pendiente&pedido=" + orderId,
      },
      auto_return: "approved",
      notification_url: origin + "/api/mp-webhook",
      statement_descriptor: "PUNTO SANDWICH",
    };

    let mpResp, mpData;
    try {
      mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + env.MP_ACCESS_TOKEN,
        },
        body: JSON.stringify(preferenceBody),
      });
      mpData = await mpResp.json().catch(() => ({}));
    } catch (err) {
      return json({ error: "no se pudo conectar con Mercado Pago" }, 502);
    }

    if (!mpResp.ok || !mpData.init_point) {
      return json(
        {
          error: "Mercado Pago rechazó la solicitud de pago",
          detail: (mpData && (mpData.message || mpData.error)) || String(mpResp.status),
        },
        502
      );
    }

    await env.DB.prepare(
      "UPDATE orders SET mp_preference_id = ? WHERE id = ?"
    ).bind(mpData.id || null, orderId).run();

    return json({ orderNumber: orderId, createdAt, initPoint: mpData.init_point }, 201);
  } catch (err) {
    return json({ error: "error interno", detail: String((err && err.message) || err) }, 500);
  }
}
