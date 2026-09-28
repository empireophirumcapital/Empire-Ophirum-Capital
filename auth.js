const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

function genEocId() {
  return 'EOC' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'email et mot de passe (8+ caracteres) requis' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'email deja utilise' });

  const hash = await bcrypt.hash(password, 12);
  const eocId = genEocId();
  const info = db
    .prepare('INSERT INTO users (eoc_id, email, password_hash) VALUES (?, ?, ?)')
    .run(eocId, email, hash);

  const token = jwt.sign(
    { uid: info.lastInsertRowid, eocId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
  res.json({ token, eocId });

  // NOTE: ici est le bon endroit pour declencher un flow KYC (obligatoire
  // avant d'autoriser depots/retraits reels) - non implemente dans ce squelette.
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');
  if (!user) return res.status(401).json({ error: 'identifiants invalides' });

  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) return res.status(401).json({ error: 'identifiants invalides' });

  const token = jwt.sign(
    { uid: user.id, eocId: user.eoc_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
  res.json({ token, eocId: user.eoc_id });

  // NOTE: brancher ici la verification 2FA/TOTP si user.totp_secret existe,
  // avant de delivrer le token (login a 2 etapes).
});

module.exports = router;
