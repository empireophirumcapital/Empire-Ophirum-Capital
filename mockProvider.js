/**
 * Prestataire "mock" - genere des adresses et des retraits FICTIFS,
 * uniquement pour developper/tester le backend sans prestataire reel.
 * N'ENVOYEZ JAMAIS DE FONDS REELS A CES ADRESSES.
 *
 * Implemente le meme contrat que fireblocksProvider.js afin d'etre
 * interchangeable dans providers/custodyProvider.js.
 */
const crypto = require('crypto');

function fakeAddress(network, seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  if (network === 'TRC20') return 'T' + h.slice(0, 33).toUpperCase();
  if (network === 'BEP20' || network === 'ERC20') return '0x' + h.slice(0, 40);
  if (network === 'BTC') return 'bc1q' + h.slice(0, 38);
  return h.slice(0, 44);
}

async function getOrCreateDepositAddress({ userId, asset, network }) {
  return {
    address: fakeAddress(network, `${userId}:${asset}:${network}`),
    providerRef: `mock-addr-${userId}-${asset}-${network}`,
  };
}

async function initiateWithdrawal({ withdrawalId, network }) {
  // En reel : appel API du prestataire qui signe et diffuse la transaction.
  // Ici on simule un statut "BROADCAST" instantane avec un faux txid.
  const txid = crypto.randomBytes(32).toString('hex');
  return { providerRef: `mock-wd-${withdrawalId}`, status: 'BROADCAST', txid };
}

async function cancelWithdrawal() {
  // no-op cote mock
  return;
}

function verifyWebhookSignature(_rawBody, _signatureHeader) {
  // Le mock accepte tout (dev uniquement). Un vrai provider DOIT verifier
  // une signature HMAC avec CUSTODY_WEBHOOK_SECRET.
  return true;
}

function parseWebhookEvent(payload) {
  // Format libre choisi pour le mock : { type, data }
  return { type: payload.type, data: payload.data };
}

module.exports = {
  getOrCreateDepositAddress,
  initiateWithdrawal,
  cancelWithdrawal,
  verifyWebhookSignature,
  parseWebhookEvent,
};
