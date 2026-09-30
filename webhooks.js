const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { ledgerPost } = require('../ledger');
const { loadProvider } = require('../providers/custodyProvider');

const router = express.Router();
const provider = loadProvider();

const userAcct = (eocId) => `USER:${eocId}`;
const pendingAcct = (eocId) => `PENDING_WD:${eocId}`;
const EXTERNAL = 'EOC_EXTERNAL';

/* IMPORTANT :
   - Ce endpoint doit recevoir le BODY BRUT (raw) pour que la verification de
     signature soit fiable -> voir server.js (express.raw sur cette route).
   - Ne JAMAIS credit un solde suite a un webhook non verifie.
   - Idempotence : chaque evenement doit pouvoir etre rejoue sans double
     credit (verifier txid/eventId avant d'ecrire). Simplifie ici. */

router.post('/custody', async (req, res) => {
  const signature = req.headers['x-provider-signature'] || '';
  const rawBody = req.body; // Buffer, cf. express.raw()

  let verified;
  try {
    verified = provider.verifyWebhookSignature(rawBody, signature);
  } catch (e) {
    console.error('verifyWebhookSignature error:', e.message);
    return res.status(501).json({ error: 'verification de signature non implementee' });
  }
  if (!verified) return res.status(401).json({ error: 'signature invalide' });

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'JSON invalide' });
  }

  const event = provider.parseWebhookEvent(payload);

  try {
    if (event.type === 'deposit.confirmed') {
      handleDepositConfirmed(event.data);
    } else if (event.type === 'withdrawal.status') {
      handleWithdrawalStatus(event.data);
    } else {
      console.warn('evenement webhook non gere:', event.type);
    }
    res.json({ received: true });
  } catch (e) {
    console.error('webhook handling error:', e.message);
    res.status(500).json({ error: 'echec de traitement du webhook' });
  }
});

function handleDepositConfirmed({ userId /* eocId */, asset, network, amount, txid, confirmations }) {
  const existing = db.prepare('SELECT id FROM deposits WHERE txid=?').get(txid);
  if (existing) return; // idempotence : deja traite

  const user = db.prepare('SELECT id FROM users WHERE eoc_id=?').get(userId);
  if (!user) return console.warn('deposit.confirmed pour un utilisateur inconnu:', userId);

  const addrRow = db
    .prepare('SELECT address FROM deposit_addresses WHERE user_id=? AND asset=? AND network=?')
    .get(user.id, asset, network);

  const depositId = 'DEP-' + uuidv4().slice(0, 8).toUpperCase();
  const ledgerTx = ledgerPost(
    db,
    `Depot confirme ${depositId}`,
    [
      { account: EXTERNAL, asset, delta: -amount },
      { account: userAcct(userId), asset, delta: amount },
    ],
    { ref: depositId }
  );

  db.prepare(
    `INSERT INTO deposits
       (id,user_id,asset,network,address,amount,txid,confirmations,required_conf,status,ledger_tx,confirmed_at)
     VALUES (?,?,?,?,?,?,?,?,?,'CONFIRMED',?,datetime('now'))`
  ).run(
    depositId, user.id, asset, network, addrRow ? addrRow.address : null, amount,
    txid, confirmations || 0, confirmations || 0, ledgerTx
  );
}

function handleWithdrawalStatus({ withdrawalId, status, txid, confirmations }) {
  const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(withdrawalId);
  if (!wd) return console.warn('withdrawal inconnu:', withdrawalId);

  db.prepare(
    'UPDATE withdrawals SET status=?, txid=COALESCE(?, txid), confirmations=?, updated_at=datetime(\'now\') WHERE id=?'
  ).run(status, txid || null, confirmations || 0, withdrawalId);

  // Les fonds ont quitte le systeme une fois le retrait definitivement
  // confirme sur la chaine -> on solde le compte PENDING_WD.
  if (status === 'COMPLETED' && wd.status !== 'COMPLETED') {
    const eocId = db.prepare('SELECT eoc_id FROM users WHERE id=?').get(wd.user_id).eoc_id;
    const completeTx = ledgerPost(
      db,
      `Retrait ${withdrawalId} - confirme on-chain`,
      [
        { account: pendingAcct(eocId), asset: wd.asset, delta: -wd.amount },
        { account: EXTERNAL, asset: wd.asset, delta: wd.amount },
      ],
      { ref: withdrawalId }
    );
    db.prepare(
      "UPDATE withdrawals SET complete_tx=?, completed_at=datetime('now') WHERE id=?"
    ).run(completeTx, withdrawalId);
  }

  // Si le prestataire rejette/echoue la transaction, on rend les fonds.
  if (['REJECTED', 'FAILED'].includes(status) && !['REJECTED', 'FAILED'].includes(wd.status)) {
    const eocId = db.prepare('SELECT eoc_id FROM users WHERE id=?').get(wd.user_id).eoc_id;
    const revertTx = ledgerPost(
      db,
      `Retrait ${withdrawalId} - echec, remboursement`,
      [
        { account: pendingAcct(eocId), asset: wd.asset, delta: -wd.amount },
        { account: userAcct(eocId), asset: wd.asset, delta: wd.amount },
      ],
      { ref: withdrawalId }
    );
    db.prepare('UPDATE withdrawals SET revert_tx=? WHERE id=?').run(revertTx, withdrawalId);
  }
}

module.exports = router;
