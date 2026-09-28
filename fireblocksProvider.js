/**
 * Squelette de prestataire de custody type Fireblocks (adaptable a BitGo,
 * Copper, Anchorage, etc. en gardant le meme contrat).
 *
 * IMPORTANT : ce fichier NE FONCTIONNE PAS tel quel. C'est un plan de
 * cablage : chaque TODO doit etre complete avec le SDK/l'API officielle
 * du prestataire choisi, en suivant SA documentation a jour (les noms
 * d'endpoints, de champs et le format des webhooks varient selon les
 * versions - je ne les invente pas ici pour ne pas vous donner de fausses
 * certitudes).
 *
 * Principes generaux valables pour la quasi-totalite des prestataires
 * custodial institutionnels :
 *  - Authentification par cle API + signature de chaque requete (souvent
 *    JWT signe avec une cle privee RSA que vous gardez hors du serveur web
 *    si possible, ex: HSM / KMS).
 *  - Les fonds sont ranges dans des "vault accounts" / sous-comptes ;
 *    chaque utilisateur EOC doit etre mappe a un vault (ou une adresse
 *    deposit unique a l'interieur d'un vault partage).
 *  - Les retraits passent par un workflow d'approbation (policy engine du
 *    prestataire + vos propres regles : reviewThreshold, whitelist, 2FA).
 *  - Les evenements (depot confirme, retrait broadcast/confirme/echoue)
 *    arrivent par WEBHOOK, signes, et JAMAIS par polling seul cote serveur.
 */

// const fetch = global.fetch; // Node 18+ a fetch natif
// const jwt = require('jsonwebtoken');
// const fs = require('fs');
// const crypto = require('crypto');

// const API_KEY = process.env.FIREBLOCKS_API_KEY;
// const BASE_URL = process.env.FIREBLOCKS_BASE_URL;
// const PRIVATE_KEY = fs.readFileSync(process.env.FIREBLOCKS_PRIVATE_KEY_PATH, 'utf8');
// const VAULT_ACCOUNT_ID = process.env.FIREBLOCKS_VAULT_ACCOUNT_ID;

async function getOrCreateDepositAddress({ userId, asset, network }) {
  // TODO: appeler l'API du prestataire pour obtenir/creer une adresse de
  // depot associee a (userId, asset, network), typiquement dans un vault
  // account dedie a l'utilisateur ou avec un tag/memo qui l'identifie.
  //
  // Exemple d'approche (a adapter a la doc officielle du prestataire) :
  //   1. Verifier si un vault/sous-compte existe deja pour userId -> sinon le creer
  //   2. Demander une adresse de depot pour (asset, network) sur ce vault
  //   3. Retourner { address, providerRef: <id du vault ou de l'adresse> }
  throw new Error(
    'fireblocksProvider.getOrCreateDepositAddress: a implementer avec le SDK du prestataire choisi'
  );
}

async function initiateWithdrawal({ userId, withdrawalId, asset, network, address, amount }) {
  // TODO: creer une transaction de retrait cote prestataire :
  //   - source: le vault de l'utilisateur (ou le vault omnibus + comptabilite interne)
  //   - destination: `address`
  //   - montant: `amount`
  //   - externalTxId: withdrawalId (pour idempotence et reconciliation)
  // Le prestataire renvoie generalement un id de transaction + un statut
  // initial (SUBMITTED/PENDING_SIGNATURE/etc. selon sa policy d'approbation).
  // Retourner { providerRef, status, txid } (txid peut etre absent tant que
  // la transaction n'est pas diffusee - dans ce cas le webhook la fournira).
  throw new Error(
    'fireblocksProvider.initiateWithdrawal: a implementer avec le SDK du prestataire choisi'
  );
}

async function cancelWithdrawal({ withdrawalId, providerRef }) {
  // TODO: appeler l'endpoint d'annulation du prestataire pour providerRef.
  // Attention : une transaction deja diffusee sur la blockchain n'est
  // PAS annulable - ne l'autoriser que si le statut cote prestataire le permet.
  throw new Error(
    'fireblocksProvider.cancelWithdrawal: a implementer avec le SDK du prestataire choisi'
  );
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  // TODO: verifier la signature du webhook avec la cle publique fournie par
  // le prestataire (ex: verification RSA/ECDSA de rawBody contre
  // signatureHeader). NE JAMAIS traiter un webhook non verifie : c'est le
  // seul rempart contre un faux "depot confirme" qui crediterait un compte
  // sans fonds reels recus.
  throw new Error(
    'fireblocksProvider.verifyWebhookSignature: a implementer avec la cle publique du prestataire'
  );
}

function parseWebhookEvent(payload) {
  // TODO: adapter au format d'evenements du prestataire. Objectif : ramener
  // chaque evenement a une forme commune { type, data } consommee par
  // routes/webhooks.js, avec au minimum pour un depot :
  //   { type: 'deposit.confirmed', data: { userId, asset, network, amount, txid, confirmations } }
  // et pour un retrait :
  //   { type: 'withdrawal.status', data: { withdrawalId, status, txid, confirmations } }
  throw new Error(
    'fireblocksProvider.parseWebhookEvent: a implementer selon le format du prestataire'
  );
}

module.exports = {
  getOrCreateDepositAddress,
  initiateWithdrawal,
  cancelWithdrawal,
  verifyWebhookSignature,
  parseWebhookEvent,
};
