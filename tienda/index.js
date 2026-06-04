// Tienda de canjes — gastar Omegacoins en cosméticos/estatus de Discord (no cuesta dinero real).
//   GET  /api/tienda                 catálogo + mi saldo
//   POST /api/tienda/comprar         { key, note? } (usuario)
//   GET  /api/tienda/mis-compras     (usuario)
//   GET  /api/tienda/pedidos         pedidos manuales pendientes (admin)
//   POST /api/tienda/pedido/:id/completar  (admin)

const express = require("express");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");
const { spendCoins, addCoins, getBalance } = require("../omegacoins");
const { hasBannedContent } = require("../lib/filter");

const router = express.Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false })
  : null;

// Catálogo (precios pensados para una economía donde un activo gana ~300-700/sem).
// type 'role' = el bot lo entrega al instante. type 'order' = lo cumple un admin.
const CATALOG = [
  { key: "nombre_aqua", name: "Nombre Aqua", icon: "🌊", desc: "Color de nombre aqua llamativo (permanente).", price: 6000, type: "role", roleName: "🌊 Aqua", color: 0x00d9ff, hoist: false },
  { key: "nombre_rosa", name: "Nombre Rosa", icon: "🌸", desc: "Color de nombre rosa (permanente).", price: 6000, type: "role", roleName: "🌸 Rosa", color: 0xff6fae, hoist: false },
  { key: "vc_rename", name: "Renombrar canal de voz 24h", icon: "🎤", desc: "Le pones el nombre que quieras a un canal de voz por 24h (automático, con filtro).", price: 5000, type: "auto", pickChannel: true },
  { key: "shoutout", name: "Shoutout en anuncios", icon: "📢", desc: "Publicamos tu mensaje en anuncios al instante (automático, con filtro).", price: 8000, type: "auto", needsNote: "¿Qué quieres que anunciemos? (link/texto)" },
  { key: "color_custom", name: "Color personalizado", icon: "🎨", desc: "Eliges el color EXACTO de tu nombre (permanente).", price: 9000, type: "order", needsNote: "Pon el color (ej: #ff3b3b)" },
  { key: "emoji", name: "Emoji al servidor", icon: "😎", desc: "Propones un emoji y lo agregamos al server (sujeto a aprobación).", price: 14000, type: "order", needsNote: "Link/imagen del emoji y nombre" },
  { key: "mecenas", name: "Mecenas", icon: "🎖️", desc: "Rol dorado destacado + 🎖️ junto a tu nombre (Discord y web).", price: 15000, type: "role", roleName: "🎖️ Mecenas", color: 0xffd35c, hoist: true, nameEmoji: "🎖️" },
  { key: "patron", name: "Patrón Omega", icon: "💜", desc: "Rol de prestigio morado + 💜 decorando tu nombre (Discord y web).", price: 25000, type: "role", roleName: "💜 Patrón Omega", color: 0xc084fc, hoist: true, nameEmoji: "💜" },
];
const BYKEY = Object.fromEntries(CATALOG.map((i) => [i.key, i]));
const pubItem = (i) => ({ key: i.key, name: i.name, icon: i.icon, desc: i.desc, price: i.price, type: i.type, needsNote: i.needsNote || "", pickChannel: !!i.pickChannel });

async function initTienda() {
  if (!pool) { console.warn("[tienda] sin DATABASE_URL: módulo deshabilitado."); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_purchases (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      buyer_name TEXT NOT NULL DEFAULT '',
      item_key TEXT NOT NULL,
      item_name TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'role',
      status TEXT NOT NULL DEFAULT 'completado',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Decoración de nombre (emoji que se antepone al nombre en Discord y en la web).
  await pool.query("CREATE TABLE IF NOT EXISTS user_decoration (discord_id TEXT PRIMARY KEY, emoji TEXT NOT NULL DEFAULT '')");
  // Backfill: quien ya compró Patrón/Mecenas antes de esta función, recibe su decoración.
  try {
    await pool.query(`
      INSERT INTO user_decoration (discord_id, emoji)
      SELECT DISTINCT discord_id, CASE WHEN item_key = 'patron' THEN '💜' ELSE '🎖️' END
      FROM store_purchases WHERE item_key IN ('patron', 'mecenas')
      ON CONFLICT (discord_id) DO NOTHING
    `);
  } catch (e) { /* noop */ }
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Solo administradores." });
    next();
  });
}

router.get("/api/tienda", async (req, res) => {
  return res.json({ items: CATALOG.map(pubItem) });
});

// Mi saldo + artículos ya comprados (para la tienda).
router.get("/api/tienda/saldo", requireUser, async (req, res) => {
  try {
    const balance = await getBalance(req.user.discordId);
    let owned = [];
    try { const o = await pool.query("SELECT DISTINCT item_key FROM store_purchases WHERE discord_id = $1", [req.user.discordId]); owned = o.rows.map((r) => r.item_key); } catch (e) {}
    return res.json({ balance, owned });
  } catch (e) { return res.json({ balance: 0, owned: [] }); }
});

router.post("/api/tienda/comprar", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "BD no configurada." });
  const item = BYKEY[String(req.body?.key || "")];
  if (!item) return res.status(400).json({ error: "Artículo inválido." });
  // Los roles permanentes son de compra única.
  if (item.type === "role") {
    const owned = await pool.query("SELECT 1 FROM store_purchases WHERE discord_id = $1 AND item_key = $2 LIMIT 1", [req.user.discordId, item.key]);
    if (owned.rows.length) return res.status(400).json({ error: "Ya tienes este artículo." });
  }
  const note = String(req.body?.note || "").slice(0, 300);
  const channelId = String(req.body?.channelId || "");
  const buyerName = req.user.globalName || req.user.username || "Jugador";
  const da = require("../discord-activity");

  // Validaciones (con filtro) de los canjes automáticos, ANTES de cobrar.
  if (item.key === "shoutout") {
    if (!note.trim()) return res.status(400).json({ error: "Escribe el texto del shoutout." });
    if (hasBannedContent(note)) return res.status(400).json({ error: "Ese texto tiene contenido no permitido (odio/obsceno)." });
  }
  if (item.key === "vc_rename") {
    const vcs = da.getVoiceChannels ? da.getVoiceChannels() : [];
    if (!vcs.find((v) => v.id === channelId)) return res.status(400).json({ error: "Elige un canal de voz válido." });
    if (!note.trim()) return res.status(400).json({ error: "Escribe el nuevo nombre del canal." });
    if (hasBannedContent(note)) return res.status(400).json({ error: "Ese nombre tiene contenido no permitido." });
  }

  const spend = await spendCoins(req.user.discordId, item.price, `Tienda: ${item.name}`);
  if (!spend.ok) return res.status(400).json({ error: spend.error === "saldo" ? "No te alcanza el saldo de Omegacoins." : "No se pudo procesar." });
  const refund = (msg) => addCoins(req.user.discordId, item.price, `Reembolso: ${item.name}`).then(() => res.status(500).json({ error: msg }));

  let status = "completado";
  let detail = note;
  if (item.type === "role") {
    let ok = false;
    try { ok = await da.grantStoreRole(req.user.discordId, item.roleName, item.color, item.hoist); } catch (e) { ok = false; }
    if (!ok) return refund("No se pudo entregar el rol. Te reembolsamos.");
    if (item.nameEmoji) {
      try { await pool.query("INSERT INTO user_decoration (discord_id, emoji) VALUES ($1,$2) ON CONFLICT (discord_id) DO UPDATE SET emoji = EXCLUDED.emoji", [req.user.discordId, item.nameEmoji]); } catch (e) {}
      try { da.setNameDecoration?.(req.user.discordId, item.nameEmoji); } catch (e) {}
    }
  } else if (item.key === "shoutout") {
    let ok = false;
    try { ok = await da.postShoutout(note, buyerName); } catch (e) { ok = false; }
    if (!ok) return refund("No se pudo publicar el shoutout. Te reembolsamos.");
  } else if (item.key === "vc_rename") {
    let ok = false;
    try { ok = await da.renameVoiceChannel(channelId, note, 24); } catch (e) { ok = false; }
    if (!ok) return refund("No se pudo renombrar el canal. Te reembolsamos.");
    detail = `Canal renombrado a "${note}" por 24h`;
  } else {
    status = "pendiente"; // color_custom, emoji -> los cumple un admin
  }

  try {
    await pool.query(
      "INSERT INTO store_purchases (discord_id, buyer_name, item_key, item_name, price, type, status, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [req.user.discordId, buyerName, item.key, item.name, item.price, item.type, status, detail],
    );
  } catch (e) { /* noop */ }

  try {
    if (status === "pendiente") da.dmUser?.(req.user.discordId, `🛒 Compraste "${item.name}". Un admin lo prepara y te avisa. ¡Gracias!`);
    else da.dmUser?.(req.user.discordId, `🛒 ¡Listo! Canjeaste "${item.name}". Disfrútalo 😎`);
    da.notifyAdmins?.("🛒 Canje en la tienda", `**${buyerName}** canjeó **${item.name}** (${item.price} 🪙)${detail ? `\n📝 ${detail}` : ""}${status === "pendiente" ? "\n⏳ Requiere acción manual." : ""}`, 0xffd35c);
  } catch (e) { /* noop */ }

  return res.json({ ok: true, balance: spend.balance, status });
});

// Canales de voz para el select de la tienda.
router.get("/api/tienda/canales-voz", (req, res) => {
  try { return res.json(require("../discord-activity").getVoiceChannels?.() || []); }
  catch (e) { return res.json([]); }
});

router.get("/api/tienda/mis-compras", requireUser, async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const r = await pool.query("SELECT item_name, price, status, created_at FROM store_purchases WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 20", [req.user.discordId]);
    return res.json(r.rows.map((x) => ({ name: x.item_name, price: x.price, status: x.status, at: x.created_at })));
  } catch (e) { return res.json([]); }
});

// Pedidos manuales pendientes (admin).
router.get("/api/tienda/pedidos", requireAdmin, async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const r = await pool.query("SELECT id, discord_id, buyer_name, item_name, note, created_at FROM store_purchases WHERE status = 'pendiente' ORDER BY created_at ASC");
    return res.json(r.rows.map((x) => ({ id: x.id, discordId: x.discord_id, buyer: x.buyer_name, item: x.item_name, note: x.note, at: x.created_at })));
  } catch (e) { return res.json([]); }
});

router.post("/api/tienda/pedido/:id/completar", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query("UPDATE store_purchases SET status = 'completado' WHERE id = $1 RETURNING discord_id, item_name", [req.params.id]);
    if (r.rows[0]) { try { require("../discord-activity").dmUser?.(r.rows[0].discord_id, `✅ ¡Tu pedido "${r.rows[0].item_name}" ya está listo!`); } catch (e) {} }
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: "No se pudo." }); }
});

module.exports = { router, initTienda };
