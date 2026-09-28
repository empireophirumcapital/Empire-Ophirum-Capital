/**
 * Ledger en double ecriture - VERSION SERVEUR.
 * C'est la seule source de verite pour les soldes en mode live.
 * (equivalent serveur de ledgerPost() dans eoc-exchange-complete-6.html)
 *
 * Regle : chaque ecriture (tx) est un tableau de "legs" dont la somme des
 * deltas, PAR ACTIF, doit etre nulle. Un compte USER:* ne peut jamais
 * passer negatif.
 */

const R10 = (x) => Math.round(x * 1e10) / 1e10;

function nextTxRef(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM ledger_tx').get();
  return 'TX-EOC-' + String(row.n + 1).padStart(5, '0');
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} memo
 * @param {{account:string, asset:string, delta:number}[]} legs
 * @param {{ref?:string}} [meta]
 * @returns {string} tx_ref
 */
function ledgerPost(db, memo, legs, meta = {}) {
  if (!legs.length) throw new Error('EMPTY_LEDGER_ENTRY');

  // 1) la somme des deltas doit etre nulle, par actif
  const sums = {};
  for (const l of legs) sums[l.asset] = R10((sums[l.asset] || 0) + l.delta);
  for (const asset in sums) {
    if (Math.abs(sums[asset]) > 1e-9) {
      throw new Error(`LEDGER_UNBALANCED:${asset}`);
    }
  }

  const getBalance = db.prepare(
    'SELECT balance FROM balances WHERE account = ? AND asset = ?'
  );
  const upsertBalance = db.prepare(`
    INSERT INTO balances (account, asset, balance) VALUES (?, ?, ?)
    ON CONFLICT(account, asset) DO UPDATE SET balance = excluded.balance
  `);

  const run = db.transaction(() => {
    // 2) verification anti-solde-negatif sur les comptes utilisateurs
    for (const l of legs) {
      if (l.account.startsWith('USER:')) {
        const current = getBalance.get(l.account, l.asset)?.balance || 0;
        if (R10(current + l.delta) < -1e-9) {
          throw new Error('INSUFFICIENT_FUNDS');
        }
      }
    }

    // 3) ecriture de la transaction + des legs + mise a jour des soldes
    const txRef = nextTxRef(db);
    const txRow = db
      .prepare('INSERT INTO ledger_tx (tx_ref, memo, ref) VALUES (?, ?, ?)')
      .run(txRef, memo, meta.ref || null);

    const insertLeg = db.prepare(
      'INSERT INTO ledger_legs (tx_id, account, asset, delta) VALUES (?, ?, ?, ?)'
    );
    for (const l of legs) {
      insertLeg.run(txRow.lastInsertRowid, l.account, l.asset, l.delta);
      const current = getBalance.get(l.account, l.asset)?.balance || 0;
      upsertBalance.run(l.account, l.asset, R10(current + l.delta));
    }

    return txRef;
  });

  return run();
}

/** Solde d'un compte pour un actif (0 si inexistant). */
function getBalance(db, account, asset) {
  const row = db
    .prepare('SELECT balance FROM balances WHERE account = ? AND asset = ?')
    .get(account, asset);
  return row ? row.balance : 0;
}

/** Tous les soldes USER:<eocId>:* -> { ASSET: montant } */
function getUserAssets(db, eocId) {
  const rows = db
    .prepare("SELECT asset, balance FROM balances WHERE account = ?")
    .all(`USER:${eocId}`);
  const out = {};
  for (const r of rows) out[r.asset] = r.balance;
  return out;
}

/** Verifie l'equilibre global du ledger (outil de reconciliation/audit). */
function reconcile(db) {
  const issues = [];
  const rows = db.prepare('SELECT account, asset, balance FROM balances').all();
  const sums = {};
  for (const r of rows) sums[r.asset] = R10((sums[r.asset] || 0) + r.balance);
  for (const asset in sums) {
    if (Math.abs(sums[asset]) > 1e-8) issues.push(`${asset} : ledger desequilibre (somme=${sums[asset]})`);
  }
  return issues;
}

module.exports = { ledgerPost, getBalance, getUserAssets, reconcile, R10 };
