const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { ledgerPost, getUserAssets } = require('../ledger');
const { RULES, isValidAddress, isSupportedPair, NETS, ASSET_NETS } = require('../config');
const { loadProvider } = require('../providers/custodyProvider');

const router = express.Router();
const provider = loadProvider();

const userAcct = (eocId) => `USER:${eocId}`;
const pendingAcct = (eocId) => `PENDING_WD:${eocId}`;
const EXTERNAL = 'EOC_EXTERNAL';

/* -----------------------------------------------------------------------
 * Mapping DB (snake_case) -> forme EXACTE attendue par le frontend
 * (camelCase, memes noms de champs que demoCreateWithdrawal / simulateDeposit
 * dans eoc-exchange-complete-6.html) pour que renderWallet()/showWalletTx()
 * fonctionnent sans aucune modification supplementaire.
 * ------------------------------------------------------------------- */
function mapDeposit(d) {
  return {
    id: d.id,
    userId: db.prepare('SELECT eoc_id FROM users WHERE id=?').get(d.user_id).eoc_id,
    asset: d.asset,
    network: d.network,
    address: d.address,
    amount: d.amount,
    txid: d.txid,
    confirmations: d.confirmations,
    requiredConf: d.required_conf,
    status: d.status,
    reason: d.reason,
    ledgerTx: d.ledger_tx,
    createdAt: d.created_at,
    confirmedAt: d.confirmed_at,
  };
}

function mapWithdrawal(w) {
  return {
    id: w.id,
    userId: db.prepare('SELECT eoc_id FROM users WHERE id=?').get(w.user_id).eoc_id,
    asset: w.asset,
    network: w.network,
    address: w.address,
    amount: w.amount,
    fee: w.fee,
    net: w.net,
    value: w.value,
    flags: JSON.parse(w.flags || '[]'),
    txid: w.txid,
    confirmations: w.confirmations,
    requiredConf: w.required_conf,
    status: w.status,
    createdAt: w.created_at,
    completedAt: w.completed_at,
    lockTx: w.lock_tx,
    completeTx: w.complete_tx,
    revertTx: w.revert_tx,
  };
}

function mapWhitelist(e) {
  return {
    id: String(e.id),
    network: e.network,
    address: e.address,
    label: e.label,
    addedAt: e.added_at,
    activeAt: e.active_at,
  };
}

/* ---------------------------------------------------------------------
 * POST /api/wallet/deposit-address   { asset, network }
 * ------------------------------------------------------------------- */
router.post('/deposit-address', requireAuth, async (req, res) => {
  const { asset, network } = req.body || {};
  if (!isSupportedPair(asset, network)) {
    return res.status(400).json({ error: 'paire actif/reseau non supportee' });
  }

  const existing = db
    .prepare('SELECT address, created_at FROM deposit_addresses WHERE user_id=? AND asset=? AND network=?')
    .get(req.user.id, asset, network);
  if (existing) {
    return res.json({ address: existing.address, createdAt: existing.created_at });
  }

  try {
    const { address, providerRef } = await provider.getOrCreateDepositAddress({
      userId: req.user.eoc_id,
      asset,
      network,
    });
    db.prepare(
      'INSERT INTO deposit_addresses (user_id, asset, network, address, provider_ref) VALUES (?,?,?,?,?)'
    ).run(req.user.id, asset, network, address, providerRef || null);
    res.json({ address });
  } catch (e) {
    res.status(502).json({ error: "echec de generation d'adresse aupres du prestataire", detail: e.message });
  }
});

/* ---------------------------------------------------------------------
 * POST /api/wallet/withdrawals   { asset, network, address, amount, twoFaCode, emailCode }
 * ------------------------------------------------------------------- */
router.post('/withdrawals', requireAuth, async (req, res) => {
  const { asset, network, address, amount, twoFaCode, emailCode } = req.body || {};
  const amt = Number(amount);
  const eocId = req.user.eoc_id;

  if (!isSupportedPair(asset, network)) {
    return res.status(400).json({ error: 'paire actif/reseau non supportee' });
  }
  if (!isValidAddress(network, address)) {
    return res.status(400).json({ error: 'adresse invalide pour ce reseau' });
  }
  if (!(amt > 0)) {
    return res.status(400).json({ error: 'montant invalide' });
  }
  const cfg = ASSET_NETS[asset];
  const fee = cfg.fee[network] || 0;
  if (amt < cfg.min) {
    return res.status(400).json({ error: `montant minimum: ${cfg.min} ${asset}` });
  }
  if (amt <= fee) {
    return res.status(400).json({ error: 'le montant doit depasser les frais reseau' });
  }

  // TODO: verification 2FA reelle (TOTP) contre req.user.totp_secret,
  // et verification du code email (code a usage unique stocke en cache
  // avec expiration). Ici, on exige juste la presence des champs -
  // A REMPLACER avant toute mise en prod.
  if (!twoFaCode || !emailCode) {
    return res.status(400).json({ error: '2FA et code email requis' });
  }

  // Adresse propre a EOC (depot) interdite comme destination de retrait
  const ownAddr = db
    .prepare('SELECT 1 FROM deposit_addresses WHERE address=?')
    .get(address);
  if (ownAddr) {
    return res.status(400).json({ error: 'impossible de retirer vers une adresse de depot EOC' });
  }

  // Whitelist obligatoire, verifiee cote serveur (source de verite unique)
  const wl = db
    .prepare('SELECT * FROM whitelist WHERE user_id=? AND network=? AND address=?')
    .get(req.user.id, network, address);
  if (!wl) {
    return res.status(400).json({ error: 'nouvelle adresse : ajoutez-la a la whitelist avant de retirer' });
  }
  if (wl.active_at > Date.now()) {
    return res.status(400).json({ error: "adresse en periode d'attente de securite" });
  }

  const currentBalance = (getUserAssets(db, eocId)[asset]) || 0;
  if (amt > currentBalance) {
    return res.status(400).json({ error: 'solde insuffisant' });
  }

  // NOTE fiat: sans oracle de prix branche cote serveur, `value` est
  // placeholder = montant en unite de l'actif. Pour que dailyLimit /
  // reviewThreshold aient un sens en devise reelle, branchez ici un vrai
  // service de prix (feed de marche signe), jamais une valeur fournie par
  // le client.
  const value = amt;

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(value),0) AS total FROM withdrawals
       WHERE user_id=? AND created_at >= ? AND status NOT IN ('CANCELLED','REJECTED')`
    )
    .get(req.user.id, since);
  if (row.total + value > RULES.dailyLimit) {
    return res.status(400).json({ error: 'limite de retrait journaliere depassee' });
  }

  const flags = [];
  const needsReview = value > RULES.reviewThreshold;
  if (needsReview) flags.push(`Montant eleve (> ${RULES.reviewThreshold})`);
  if (currentBalance > 0 && amt / currentBalance > 0.9 && value > 1000) {
    flags.push('Plus de 90% du solde retire');
  }

  const withdrawalId = 'WD-' + uuidv4().slice(0, 8).toUpperCase();
  const net = Math.round((amt - fee) * 1e10) / 1e10;
  const initialStatus = flags.length ? 'REVIEW' : 'PENDING';

  try {
    const lockTx = ledgerPost(
      db,
      `Retrait ${withdrawalId} - verrouillage`,
      [
        { account: userAcct(eocId), asset, delta: -amt },
        { account: pendingAcct(eocId), asset, delta: amt },
      ],
      { ref: withdrawalId }
    );

    db.prepare(
      `INSERT INTO withdrawals
         (id, user_id, asset, network, address, amount, fee, net, value, flags, status, required_conf, lock_tx)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      withdrawalId, req.user.id, asset, network, address, amt, fee, net, value,
      JSON.stringify(flags), initialStatus, NETS[network].conf, lockTx
    );

    if (!flags.length) {
      await submitToProvider(withdrawalId, { eocId, asset, network, address, amt });
    }

    const final = db.prepare('SELECT status FROM withdrawals WHERE id=?').get(withdrawalId);
    res.json({ id: withdrawalId, status: final.status });
  } catch (e) {
    if (e.message === 'INSUFFICIENT_FUNDS') {
      return res.status(400).json({ error: 'solde insuffisant' });
    }
    res.status(500).json({ error: 'echec de creation du retrait', detail: e.message });
  }
});

async function submitToProvider(withdrawalId, { eocId, asset, network, address, amt }) {
  try {
    const result = await provider.initiateWithdrawal({
      userId: eocId,
      withdrawalId,
      asset,
      network,
      address,
      amount: amt,
    });
    db.prepare(
      "UPDATE withdrawals SET status=?, txid=?, provider_ref=?, updated_at=datetime('now') WHERE id=?"
    ).run(result.status || 'PROCESSING', result.txid || null, result.providerRef || null, withdrawalId);
  } catch (e) {
    // Le retrait reste verrouille (PENDING_WD) - une revue manuelle devra
    // le debloquer. Ne JAMAIS liberer les fonds automatiquement suite a
    // une erreur reseau/API.
    db.prepare(
      "UPDATE withdrawals SET status=?, updated_at=datetime('now') WHERE id=?"
    ).run('REVIEW', withdrawalId);
    console.error(`submitToProvider(${withdrawalId}) failed:`, e.message);
  }
}

/* ---------------------------------------------------------------------
 * POST /api/wallet/withdrawals/:id/cancel
 * ------------------------------------------------------------------- */
router.post('/withdrawals/:id/cancel', requireAuth, async (req, res) => {
  const wd = db
    .prepare('SELECT * FROM withdrawals WHERE id=? AND user_id=?')
    .get(req.params.id, req.user.id);
  if (!wd) return res.status(404).json({ error: 'retrait introuvable' });
  if (!['PENDING', 'REVIEW'].includes(wd.status)) {
    return res.status(400).json({ error: 'ce retrait ne peut plus etre annule' });
  }

  const eocId = req.user.eoc_id;
  try {
    if (wd.provider_ref) {
      await provider.cancelWithdrawal({ withdrawalId: wd.id, providerRef: wd.provider_ref });
    }
    const revertTx = ledgerPost(
      db,
      `Retrait ${wd.id} - annulation`,
      [
        { account: pendingAcct(eocId), asset: wd.asset, delta: -wd.amount },
        { account: userAcct(eocId), asset: wd.asset, delta: wd.amount },
      ],
      { ref: wd.id }
    );
    db.prepare(
      "UPDATE withdrawals SET status=?, revert_tx=?, updated_at=datetime('now') WHERE id=?"
    ).run('CANCELLED', revertTx, wd.id);
    res.json({ id: wd.id, status: 'CANCELLED' });
  } catch (e) {
    res.status(500).json({ error: "echec de l'annulation", detail: e.message });
  }
});

/* ---------------------------------------------------------------------
 * Whitelist d'adresses de retrait - source de verite serveur.
 * Le frontend actuel gere encore une copie locale (voir README de
 * livraison) ; ces routes permettent de la faire respecter reellement.
 * ------------------------------------------------------------------- */
router.get('/whitelist', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM whitelist WHERE user_id=? ORDER BY added_at DESC')
    .all(req.user.id);
  res.json(rows.map(mapWhitelist));
});

router.post('/whitelist', requireAuth, (req, res) => {
  const { network, address, label } = req.body || {};
  if (!isValidAddress(network, address)) {
    return res.status(400).json({ error: 'adresse invalide pour ce reseau' });
  }
  const now = Date.now();
  const info = db
    .prepare('INSERT INTO whitelist (user_id, label, network, address, added_at, active_at) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, label || 'Adresse', network, address, now, now + RULES.addrDelayMs);
  const row = db.prepare('SELECT * FROM whitelist WHERE id=?').get(info.lastInsertRowid);
  res.json(mapWhitelist(row));
});

router.delete('/whitelist/:id', requireAuth, (req, res) => {
  const info = db
    .prepare('DELETE FROM whitelist WHERE id=? AND user_id=?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'adresse introuvable' });
  res.json({ deleted: true });
});

/* ---------------------------------------------------------------------
 * GET /api/wallet/state
 * ------------------------------------------------------------------- */
router.get('/state', requireAuth, (req, res) => {
  const eocId = req.user.eoc_id;

  const deposits = db
    .prepare('SELECT * FROM deposits WHERE user_id=? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id)
    .map(mapDeposit);

  const withdrawals = db
    .prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id)
    .map(mapWithdrawal);

  const whitelist = db
    .prepare('SELECT * FROM whitelist WHERE user_id=? ORDER BY added_at DESC')
    .all(req.user.id)
    .map(mapWhitelist);

  const addrRows = db
    .prepare('SELECT asset, network, address, created_at FROM deposit_addresses WHERE user_id=?')
    .all(req.user.id);
  const addrs = {};
  for (const a of addrRows) addrs[`${a.asset}:${a.network}`] = { address: a.address, createdAt: a.created_at };

  // Ledger : uniquement les tx qui touchent les comptes de cet utilisateur,
  // regroupees par transaction avec toutes leurs legs (meme forme que le
  // ledgerPost() cote frontend).
  const txRows = db
    .prepare(
      `SELECT DISTINCT t.id, t.tx_ref, t.memo, t.created_at, t.ref
       FROM ledger_tx t JOIN ledger_legs l ON l.tx_id = t.id
       WHERE l.account IN (?, ?)
       ORDER BY t.id DESC LIMIT 100`
    )
    .all(userAcct(eocId), pendingAcct(eocId));
  const legStmt = db.prepare('SELECT account AS acct, asset, delta FROM ledger_legs WHERE tx_id=?');
  const ledger = txRows.map((t) => ({
    id: t.tx_ref,
    memo: t.memo,
    date: t.created_at,
    ref: t.ref,
    legs: legStmt.all(t.id),
  }));

  // Soldes exposes sous la forme 'ACCT:ASSET' -> montant, meme convention
  // que W.balances cote frontend (utilise par reconcile()/riskCheck()).
  const balRows = db
    .prepare('SELECT account, asset, balance FROM balances WHERE account IN (?, ?)')
    .all(userAcct(eocId), pendingAcct(eocId));
  const balances = {};
  for (const r of balRows) {
    const prefix = r.account.startsWith('PENDING_WD:') ? 'PENDING_WD' : 'USER';
    balances[`${prefix}:${r.asset}`] = r.balance;
  }

  res.json({
    wallet: { deposits, withdrawals, ledger, addrs, whitelist, balances },
    assets: getUserAssets(db, eocId),
  });
});

module.exports = router;
