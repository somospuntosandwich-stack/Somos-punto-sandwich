// Cloudflare Pages Function for /api/mp-webhook
// POST -> called by Mercado Pago itself (never by our own site or the
// customer's browser) whenever a payment's status changes. This is the
// ONLY place a payment is considered confirmed — the customer's browser
// getting redirected back from Mercado Pago (see functions/api/create-preference.js
// and the ?pago=... handling in public/index.html) is just for their own
// screen and is never trusted on its own to mark an order as paid.
//
// Mercado Pago points this URL at us per-preference (set as notification_url
// when the preference is created), so there's nothing to configure by hand
// in the Mercado Pago dashboard for this to work.
//
// Self-contained on purpose (no shared imports) — see functions/api/orders.js
// for why.

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.MP_ACCESS_TOKEN) {
      // Nothing we can verify without a token — ack so Mercado Pago doesn't
      // hammer us with retries over a misconfiguration only we can fix.
      return json({ ok: true, ignored: true });
    }

    const url = new URL(request.url);
    let paymentId = url.searchParams.get("data.id") || url.searchParams.get("id");
    let type = url.searchParams.get("type") || url.searchParams.get("topic");

    // Depending on how Mercado Pago sends the notification, the same info
    // can arrive in the JSON body instead of the query string.
    if (!paymentId || !type) {
      const body = await request.json().catch(() => ({}));
      paymentId = paymentId || (body && body.data && body.data.id) || (body && body.id);
      type = type || (body && (body.type || body.topic));
    }

    // We only care about actual payment notifications — merchant_order and
    // other notification types don't carry a payment status directly.
    if (type !== "payment" || !paymentId) {
      return json({ ok: true, ignored: true });
    }

    const payResp = await fetch("https://api.mercadopago.com/v1/payments/" + paymentId, {
      headers: { "Authorization": "Bearer " + env.MP_ACCESS_TOKEN },
    });
    if (!payResp.ok) {
      // Ask Mercado Pago to retry later rather than silently losing this.
      return json({ error: "no se pudo consultar el pago en Mercado Pago" }, 502);
    }
    const payment = await payResp.json();
    const orderId = parseInt(payment.external_reference, 10);
    if (!orderId) return json({ ok: true, ignored: true });

    // Mercado Pago's own payment statuses (approved, pending, in_process,
    // rejected, cancelled, refunded, charged_back, ...) are stored as-is —
    // the admin panel shows them translated.
    await env.DB.prepare(
      "UPDATE orders SET payment_status = ?, mp_payment_id = ? WHERE id = ?"
    ).bind(payment.status || "desconocido", String(payment.id), orderId).run();

    return json({ ok: true });
  } catch (err) {
    return json({ error: "error interno", detail: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestGet() {
  // Some webhook configurations ping the notification URL with a plain GET
  // first — just acknowledge it, there's nothing to do with a GET.
  return json({ ok: true });
}
