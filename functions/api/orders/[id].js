// Cloudflare Pages Function for /api/orders/:id
// PATCH -> admin-only, advances one order's status.
//
// Self-contained on purpose (no shared imports) — see functions/api/orders.js
// for why.
//
// Pickup and delivery orders follow different status flows, and a status can
// only move to the very next step in ITS flow — never backward, never
// skipping a step. This is enforced here (not just in the admin screen) so
// there's no way to force it via a raw API call either.

var FLOWS = {
  pickup: ["preparando", "listo_retiro", "entregado"],
  delivery: ["preparando", "listo", "enviando", "entregado"],
};

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

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  try {
    if (!isAdmin(request, env)) return json({ error: "no autorizado" }, 401);

    const id = parseInt(params.id, 10);
    if (!id) return json({ error: "id invalido" }, 400);

    const body = await request.json().catch(() => ({}));
    const nextStatus = body.status;

    const order = await env.DB.prepare(
      "SELECT status, delivery_method FROM orders WHERE id = ?"
    ).bind(id).first();
    if (!order) return json({ error: "pedido no encontrado" }, 404);

    const flow = FLOWS[order.delivery_method] || FLOWS.pickup;
    const currentIndex = flow.indexOf(order.status);
    const nextIndex = flow.indexOf(nextStatus);

    if (nextIndex === -1) {
      return json({ error: "estado invalido para este tipo de entrega" }, 400);
    }
    if (nextIndex !== currentIndex + 1) {
      // Covers going backward, skipping a step, and re-sending the current
      // status — the only legal move is exactly one step forward.
      return json({
        error: "solo se puede avanzar al siguiente estado, en orden",
        currentStatus: order.status,
      }, 409);
    }

    // Guard the actual current status in the WHERE clause too, so two admins
    // tapping the same order at the same moment can't both "win" and push it
    // two steps forward.
    const result = await env.DB.prepare(
      "UPDATE orders SET status = ? WHERE id = ? AND status = ?"
    ).bind(nextStatus, id, order.status).run();

    if (!result.meta.changes) {
      return json({ error: "el pedido ya cambió de estado, actualizá la pantalla" }, 409);
    }

    return json({ id, status: nextStatus });
  } catch (err) {
    return json({ error: "error interno", detail: String((err && err.message) || err) }, 500);
  }
}
