-- Schema EOC Wallet Backend
-- Le principe : AUCUN solde n'est jamais modifie directement.
-- Toute variation de solde passe par une ecriture en double partie (voir ledger.js).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  eoc_id        TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret   TEXT,                 -- secret 2FA (TOTP) -- NULL tant que non active
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger_tx (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_ref     TEXT UNIQUE NOT NULL,     -- ex: TX-EOC-00001
  memo       TEXT,
  ref        TEXT,                    -- ex: id du retrait / depot lie
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger_legs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id   INTEGER NOT NULL REFERENCES ledger_tx(id),
  account TEXT NOT NULL,               -- ex: USER:EOC123:USDT / PENDING_WD:USDT / EOC_EXTERNAL:BTC
  asset   TEXT NOT NULL,
  delta   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS balances (
  account TEXT NOT NULL,
  asset   TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (account, asset)
);

CREATE TABLE IF NOT EXISTS deposit_addresses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  asset        TEXT NOT NULL,
  network      TEXT NOT NULL,
  address      TEXT NOT NULL,
  provider_ref TEXT,                   -- id cote prestataire custodial (ex: vaultAccountId/addressId Fireblocks)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, asset, network)
);

CREATE TABLE IF NOT EXISTS deposits (
  id             TEXT PRIMARY KEY,     -- ex: DEP-xxxxx
  user_id        INTEGER NOT NULL REFERENCES users(id),
  asset          TEXT NOT NULL,
  network        TEXT NOT NULL,
  amount         REAL NOT NULL,
  txid           TEXT,
  confirmations  INTEGER DEFAULT 0,
  required_conf  INTEGER DEFAULT 0,
  status         TEXT NOT NULL,        -- PENDING | CONFIRMED | BELOW_MIN
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id            TEXT PRIMARY KEY,      -- ex: WD-xxxxx
  user_id       INTEGER NOT NULL REFERENCES users(id),
  asset         TEXT NOT NULL,
  network       TEXT NOT NULL,
  address       TEXT NOT NULL,
  amount        REAL NOT NULL,
  status        TEXT NOT NULL,         -- PENDING | REVIEW | PROCESSING | BROADCAST | COMPLETED | CANCELLED | REJECTED
  txid          TEXT,
  confirmations INTEGER DEFAULT 0,
  required_conf INTEGER DEFAULT 0,
  provider_ref  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whitelist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  label      TEXT,
  network    TEXT NOT NULL,
  address    TEXT NOT NULL,
  active_at  TEXT NOT NULL,             -- delai de securite avant activation (ADDR_DELAY_MS)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_legs_account ON ledger_legs(account);
