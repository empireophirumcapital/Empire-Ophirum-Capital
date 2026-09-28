const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { ledgerPost, getUserAssets } = require('../ledger');
const { RULES, isValidAddress, isSupportedPair, NETS } = require('../config');
const { loadProvider } = require('../providers/custodyProvider');

const router = express.Router();
const provider = loadProvider();

const userAcct = (eocId) => `USER:${eocId}`;
const pendingAcct = (eocId) => `PENDING_WD:${eocId}`;
const EXTERNAL = 'EOC_EXTERNAL';

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
    res.status(502).json({ error: 'echec de generation d\'adresse aupres du prestataire', detail: e.message });
  }
});

/* ---------------------------------------------------------------------
 * POST /api/wallet/withdrawals   { asset, network, address, amount, twoFaCode, emailCode }
 * ------------------------------------------------------------------- */
router.post('/withdrawals', requireAuth, async (req, res) => {
  const { asset, network, address, amount, twoFaCode, emailCode } = req.body || {};
  const amt = Number(amount);

  if (!isSupportedPair(asset, network)) {
    return res.status(400).json({ error: 'paire actif/reseau non supportee' });
  }
  if (!isValidAddress(network, address)) {
    return res.status(400).json({ error: 'adresse invalide pour ce reseau' });
  }
  if (!(amt > 0)) {
    return res.status(400).json({ error: 'montant invalide' });
  }

  // TODO: verification 2FA reelle (TOTP) contre req.user.totp_secret,
  // et verification du code email (ex: code a usage unique stocke en cache
  // avec expiration). Ici, on bloque simplement si les champs sont absents
  // pour au moins materialiser l'exigence - A REMPLACER avant toute mise en prod.
  if (!twoFaCode || !emailCode) {
    return res.status(400).json({ error: '2FA et code email requis' });
  }

  // TODO: verifier que `address` est sur la whitelist de l'utilisateur ET
  // que son `active_at` est passe (delai anti-fraude RULES.addrDelayMs).

  const eocId = req.user.eoc_id;
  const currentBalance = (getUserAssets(db, eocId)[asset]) || 0;
  if (amt > currentBalance) {
    return res.status(400).json({ error: 'solde insuffisant' });
  }

  // limite glissante 24h
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS total FROM withdrawals
       WHERE user_id=? AND asset=? AND created_at >= ?
         AND status NOT IN ('CANCELLED','REJECTED')`
    )
    .get(req.user.id, asset, since);
  if (row.total + amt > RULES.dailyLimit) {
    return res.status(400).json({ error: 'limite de retrait journaliere depassee' });
  }

  const withdrawalId = 'WD-' + uuidv4().slice(0, 8).toUpperCase();
  const needsReview = amt > RULES.reviewThreshold;
  const initialStatus = needsReview ? 'REVIEW' : 'PENDING';

  try {
    // 1) on bloque les fonds : USER -> PENDING_WD (ecriture atomique)
    ledgerPost(
      db,
      `Retrait ${withdrawalId} - verrouillage`,
      [
        { account: userAcct(eocId), asset, delta: -amt },
        { account: pendingAcct(eocId), asset, delta: amt },
      ],
      { ref: withdrawalId }
    );

    db.prepare(
      `INSERT INTO withdrawals (id, user_id, asset, network, address, amount, status, required_conf)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(withdrawalId, req.user.id, asset, network, address, amt, initialStatus, NETS[network].conf);

    // 2) si pas de revue manuelle requise, on soumet tout de suite au prestataire
    if (!needsReview) {
      await submitToProvider(withdrawalId, { eocId, asset, network, address, amt });
    }

    res.json({ id: withdrawalId, status: needsReview ? 'REVIEW' : 'PROCESSING' });
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
      'UPDATE withdrawals SET status=?, txid=?, provider_ref=?, updated_at=datetime(\'now\') WHERE id=?'
    ).run(result.status || 'PROCESSING', result.txid || null, result.providerRef || null, withdrawalId);
  } catch (e) {
    // Le retrait reste verrouille (PENDING_WD) - une revue manuelle ou un
    // nouveau essai devra le debloquer. Ne JAMAIS liberer les fonds
    // automatiquement suite a une erreur reseau/API.
    db.prepare(
      'UPDATE withdrawals SET status=?, updated_at=datetime(\'now\') WHERE id=?'
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
    // deverrouillage : PENDING_WD -> USER
    ledgerPost(
      db,
      `Retrait ${wd.id} - annulation`,
      [
        { account: pendingAcct(eocId), asset: wd.asset, delta: -wd.amount },
        { account: userAcct(eocId), asset: wd.asset, delta: wd.amount },
      ],
      { ref: wd.id }
    );
    db.prepare('UPDATE withdrawals SET status=?, updated_at=datetime(\'now\') WHERE id=?').run(
      'CANCELLED',
      wd.id
    );
    res.json({ id: wd.id, status: 'CANCELLED' });
  } catch (e) {
    res.status(500).json({ error: 'echec de l\'annulation', detail: e.message });
  }
});

/* ---------------------------------------------------------------------
 * GET /api/wallet/state
 * ------------------------------------------------------------------- */
router.get('/state', requireAuth, (req, res) => {
  const eocId = req.user.eoc_id;

  const deposits = db
    .prepare('SELECT * FROM deposits WHERE user_id=? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id);
  const withdrawals = db
    .prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id);
  const whitelist = db
    .prepare('SELECT * FROM whitelist WHERE user_id=? ORDER BY created_at DESC')
    .all(req.user.id);
  const addrRows = db
    .prepare('SELECT asset, network, address, created_at FROM deposit_addresses WHERE user_id=?')
    .all(req.user.id);
  const ledger = db
    .prepare(
      `SELECT t.tx_ref AS id, t.memo, t.created_at AS date, l.account, l.asset, l.delta
       FROM ledger_legs l JOIN ledger_tx t ON t.id = l.tx_id
       WHERE l.account = ? ORDER BY t.id DESC LIMIT 100`
    )
    .all(userAcct(eocId));

  const addrs = {};
  for (const a of addrRows) addrs[`${a.asset}:${a.network}`] = { address: a.address, createdAt: a.created_at };

  res.json({
    wallet: { deposits, withdrawals, ledger, addrs, whitelist },
    assets: getUserAssets(db, eocId),
  });
});

module.exports = router;
