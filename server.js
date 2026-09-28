require('dotenv').config();
const express = require('express');
const cors = require('cors');

const db = require('./db'); // initialise le schema au demarrage

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const webhookRoutes = require('./routes/webhooks');

const app = express();

app.use(cors());

// Le webhook du prestataire de custody a besoin du BODY BRUT pour verifier
// la signature -> monte AVANT express.json(), avec son propre parseur raw.
app.use('/api/webhooks', express.raw({ type: '*/*', limit: '2mb' }), webhookRoutes);

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Gestion d'erreur generique
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'erreur serveur' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`EOC wallet backend en ecoute sur http://localhost:${PORT}`);
  console.log(`Prestataire de custody actif: ${process.env.CUSTODY_PROVIDER || 'mock'}`);
});
