// Casino de Omegacoins — Blackjack, Coinflip y Dados.
// TODO el juego es server-authoritative: el cliente solo manda apuesta/acción; el
// servidor baraja con aleatoriedad segura (crypto), cobra y paga. El blackjack se
// guarda en la BD para que un reinicio no deje una mano colgada con la apuesta cobrada.
//
//   GET  /api/casino                       saldo + límites + mano de blackjack en curso
//   POST /api/casino/coinflip   {bet, side:'cara'|'cruz'}
//   POST /api/casino/dados      {bet, guess:1..6}
//   POST /api/casino/blackjack/deal   {bet}
//   POST /api/casino/blackjack/hit
//   POST /api/casino/blackjack/stand
//   POST /api/casino/blackjack/double

const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");
const { spendCoins, addCoins, getBalance } = require("../omegacoins");

const router = express.Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false })
  : null;

// === Parámetros (fáciles de ajustar). Pagos con ligera ventaja de la casa. ===
const MIN_BET = 10;
const MAX_BET = 1000000000;        // tope de cordura (anti-overflow); sin límite real vs saldos
const COINFLIP_MULT = 1.95;        // 50/50 -> RTP 97.5%
const DADOS_MULT = 5.7;            // 1/6   -> RTP 95%
// Blackjack: gana 2x (1:1), blackjack natural 2.5x (3:2), empate devuelve apuesta.

// Ruleta europea (0-36). 0 = verde. Rojo/Negro pagan x2; Verde (0) paga x36 (~RTP 97.3%).
const RULETA_ROJO = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RULETA_MULT = { rojo: 2, negro: 2, verde: 36 };
function ruletaColor(n) { return n === 0 ? "verde" : (RULETA_ROJO.has(n) ? "rojo" : "negro"); }

async function initCasino() {
  if (!pool) { console.warn("[casino] sin DATABASE_URL: módulo deshabilitado."); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blackjack_games (
      discord_id TEXT PRIMARY KEY,
      bet INTEGER NOT NULL,
      doubled BOOLEAN NOT NULL DEFAULT false,
      deck JSONB NOT NULL,
      player JSONB NOT NULL,
      dealer JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'player',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// ---------- Utilidades de cartas ----------
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];

function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  // Fisher-Yates con aleatoriedad criptográfica.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function cardValue(c) {
  if (c.r === "A") return 11;
  if (c.r === "K" || c.r === "Q" || c.r === "J") return 10;
  return Number(c.r);
}
function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardValue(c); if (c.r === "A") aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  const soft = aces > 0 && total <= 21;
  return { total, soft, blackjack: cards.length === 2 && total === 21, bust: total > 21 };
}

// ---------- Validación de apuesta ----------
function parseBet(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < MIN_BET) return { error: `La apuesta mínima es ${MIN_BET}.` };
  if (n > MAX_BET) return { error: "Apuesta demasiado alta." };
  return { bet: n };
}

// ============ JUEGOS INSTANTÁNEOS ============
router.post("/api/casino/coinflip", requireUser, async (req, res) => {
  const side = req.body?.side === "cruz" ? "cruz" : "cara";
  const pb = parseBet(req.body?.bet);
  if (pb.error) return res.status(400).json({ error: pb.error });
  if (!pool) return res.status(503).json({ error: "BD no configurada." });

  const spend = await spendCoins(req.user.discordId, pb.bet, "Casino: Coinflip");
  if (!spend.ok) return res.status(400).json({ error: spend.error === "saldo" ? "No te alcanzan las Omegacoins." : "No se pudo apostar." });

  const result = crypto.randomInt(2) === 0 ? "cara" : "cruz";
  const won = result === side;
  let payout = 0;
  if (won) { payout = Math.floor(pb.bet * COINFLIP_MULT); await addCoins(req.user.discordId, payout, "Casino: Coinflip (ganado)"); }
  const balance = await getBalance(req.user.discordId);
  return res.json({ won, result, side, bet: pb.bet, payout, net: payout - pb.bet, balance });
});

router.post("/api/casino/dados", requireUser, async (req, res) => {
  const guess = Math.floor(Number(req.body?.guess));
  if (!(guess >= 1 && guess <= 6)) return res.status(400).json({ error: "Elige un número del 1 al 6." });
  const pb = parseBet(req.body?.bet);
  if (pb.error) return res.status(400).json({ error: pb.error });
  if (!pool) return res.status(503).json({ error: "BD no configurada." });

  const spend = await spendCoins(req.user.discordId, pb.bet, "Casino: Dados");
  if (!spend.ok) return res.status(400).json({ error: spend.error === "saldo" ? "No te alcanzan las Omegacoins." : "No se pudo apostar." });

  const roll = crypto.randomInt(6) + 1;
  const won = roll === guess;
  let payout = 0;
  if (won) { payout = Math.floor(pb.bet * DADOS_MULT); await addCoins(req.user.discordId, payout, "Casino: Dados (ganado)"); }
  const balance = await getBalance(req.user.discordId);
  return res.json({ won, roll, guess, bet: pb.bet, payout, net: payout - pb.bet, balance });
});

router.post("/api/casino/ruleta", requireUser, async (req, res) => {
  const choice = ["rojo", "negro", "verde"].includes(req.body?.choice) ? req.body.choice : null;
  if (!choice) return res.status(400).json({ error: "Elige rojo, negro o verde." });
  const pb = parseBet(req.body?.bet);
  if (pb.error) return res.status(400).json({ error: pb.error });
  if (!pool) return res.status(503).json({ error: "BD no configurada." });

  const spend = await spendCoins(req.user.discordId, pb.bet, "Casino: Ruleta");
  if (!spend.ok) return res.status(400).json({ error: spend.error === "saldo" ? "No te alcanzan las Omegacoins." : "No se pudo apostar." });

  const number = crypto.randomInt(37);
  const color = ruletaColor(number);
  const won = color === choice;
  let payout = 0;
  if (won) { payout = Math.floor(pb.bet * RULETA_MULT[choice]); await addCoins(req.user.discordId, payout, "Casino: Ruleta (ganado)"); }
  const balance = await getBalance(req.user.discordId);
  return res.json({ won, number, color, choice, bet: pb.bet, payout, net: payout - pb.bet, balance });
});

// ============ BLACKJACK ============
async function loadGame(discordId) {
  const r = await pool.query("SELECT * FROM blackjack_games WHERE discord_id = $1", [discordId]);
  return r.rows[0] || null;
}
async function saveGame(g) {
  await pool.query(
    `UPDATE blackjack_games SET deck=$2, player=$3, dealer=$4, status=$5, doubled=$6 WHERE discord_id=$1`,
    [g.discord_id, JSON.stringify(g.deck), JSON.stringify(g.player), JSON.stringify(g.dealer), g.status, g.doubled],
  );
}
async function deleteGame(discordId) {
  await pool.query("DELETE FROM blackjack_games WHERE discord_id = $1", [discordId]);
}

// Vista pública de la mano (oculta la carta tapada del dealer mientras se juega).
function publicGame(g, reveal, extra) {
  const pv = handValue(g.player);
  const out = {
    inProgress: g.status === "player",
    bet: g.bet, doubled: g.doubled,
    player: g.player, playerValue: pv.total, playerBust: pv.bust,
    ...extra,
  };
  if (reveal) {
    const dv = handValue(g.dealer);
    out.dealer = g.dealer; out.dealerValue = dv.total;
  } else {
    out.dealer = [g.dealer[0], { hidden: true }];
    out.dealerValue = cardValue(g.dealer[0]);
  }
  return out;
}

// Liquida la mano: paga según resultado, borra el juego y devuelve el resultado.
async function settle(g) {
  const stake = g.bet * (g.doubled ? 2 : 1);
  const pv = handValue(g.player);
  const dv = handValue(g.dealer);
  let outcome, payout = 0;

  if (pv.bust) { outcome = "lose"; }
  else if (pv.blackjack && !dv.blackjack) { outcome = "blackjack"; payout = Math.floor(g.bet * 2.5); }
  else if (dv.blackjack && !pv.blackjack) { outcome = "lose"; }
  else if (dv.bust) { outcome = "win"; payout = stake * 2; }
  else if (pv.total > dv.total) { outcome = "win"; payout = stake * 2; }
  else if (pv.total < dv.total) { outcome = "lose"; }
  else { outcome = "push"; payout = stake; }

  if (payout > 0) await addCoins(g.discord_id, payout, `Casino: Blackjack (${outcome})`);
  await deleteGame(g.discord_id);
  const balance = await getBalance(g.discord_id);
  const pub = publicGame(g, true, { outcome, payout, net: payout - stake, balance });
  pub.inProgress = false;
  return pub;
}

router.post("/api/casino/blackjack/deal", requireUser, async (req, res) => {
  const pb = parseBet(req.body?.bet);
  if (pb.error) return res.status(400).json({ error: pb.error });
  if (!pool) return res.status(503).json({ error: "BD no configurada." });

  const existing = await loadGame(req.user.discordId);
  if (existing) return res.status(409).json({ error: "Ya tienes una mano en curso. Termínala primero." });

  const spend = await spendCoins(req.user.discordId, pb.bet, "Casino: Blackjack");
  if (!spend.ok) return res.status(400).json({ error: spend.error === "saldo" ? "No te alcanzan las Omegacoins." : "No se pudo apostar." });

  const deck = newDeck();
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];
  const g = { discord_id: req.user.discordId, bet: pb.bet, doubled: false, deck, player, dealer, status: "player" };

  try {
    await pool.query(
      "INSERT INTO blackjack_games (discord_id, bet, doubled, deck, player, dealer, status) VALUES ($1,$2,false,$3,$4,$5,'player')",
      [g.discord_id, g.bet, JSON.stringify(deck), JSON.stringify(player), JSON.stringify(dealer), ],
    );
  } catch (e) {
    await addCoins(req.user.discordId, pb.bet, "Reembolso: Blackjack"); // no se pudo crear la mano
    return res.status(500).json({ error: "No se pudo iniciar la mano. Te reembolsamos." });
  }

  // Blackjack natural inmediato (de jugador y/o dealer) -> se liquida al instante.
  if (handValue(player).blackjack || handValue(dealer).blackjack) {
    g.status = "done";
    return res.json(await settle(g));
  }
  return res.json(publicGame(g, false, { balance: spend.balance }));
});

router.post("/api/casino/blackjack/hit", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "BD no configurada." });
  const g = await loadGame(req.user.discordId);
  if (!g || g.status !== "player") return res.status(400).json({ error: "No tienes una mano en curso." });
  g.player.push(g.deck.pop());
  if (handValue(g.player).bust) { g.status = "done"; return res.json(await settle(g)); }
  await saveGame(g);
  return res.json(publicGame(g, false));
});

async function dealerPlayAndSettle(g, res) {
  // El dealer roba hasta 17 (se planta en 17, incluido soft 17).
  while (handValue(g.dealer).total < 17) g.dealer.push(g.deck.pop());
  g.status = "done";
  return res.json(await settle(g));
}

router.post("/api/casino/blackjack/stand", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "BD no configurada." });
  const g = await loadGame(req.user.discordId);
  if (!g || g.status !== "player") return res.status(400).json({ error: "No tienes una mano en curso." });
  return dealerPlayAndSettle(g, res);
});

router.post("/api/casino/blackjack/double", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "BD no configurada." });
  const g = await loadGame(req.user.discordId);
  if (!g || g.status !== "player") return res.status(400).json({ error: "No tienes una mano en curso." });
  if (g.player.length !== 2) return res.status(400).json({ error: "Solo puedes doblar al inicio." });

  const spend = await spendCoins(req.user.discordId, g.bet, "Casino: Blackjack (doblar)");
  if (!spend.ok) return res.status(400).json({ error: spend.error === "saldo" ? "No te alcanzan las Omegacoins para doblar." : "No se pudo doblar." });

  g.doubled = true;
  g.player.push(g.deck.pop());
  if (handValue(g.player).bust) { g.status = "done"; return res.json(await settle(g)); }
  return dealerPlayAndSettle(g, res);
});

// Estado actual (saldo, límites y mano en curso si la hay).
router.get("/api/casino", requireUser, async (req, res) => {
  const limits = { min: MIN_BET, coinflipMult: COINFLIP_MULT, dadosMult: DADOS_MULT };
  if (!pool) return res.json({ balance: 0, limits, blackjack: null });
  const balance = await getBalance(req.user.discordId);
  const g = await loadGame(req.user.discordId);
  return res.json({ balance, limits, blackjack: g && g.status === "player" ? publicGame(g, false) : null });
});

module.exports = { router, initCasino };
