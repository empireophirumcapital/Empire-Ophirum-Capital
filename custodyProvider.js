/**
 * Interface commune que tout prestataire de custody (Fireblocks, BitGo, Copper...)
 * doit implementer. Les routes n'appellent JAMAIS un SDK de prestataire
 * directement : elles passent toujours par cette interface, pour pouvoir
 * changer de prestataire sans toucher aux routes.
 *
 * @typedef {Object} CustodyProvider
 * @property {(params:{userId:string, asset:string, network:string}) => Promise<{address:string, providerRef?:string}>} getOrCreateDepositAddress
 * @property {(params:{userId:string, withdrawalId:string, asset:string, network:string, address:string, amount:number}) => Promise<{providerRef:string, status:string, txid?:string}>} initiateWithdrawal
 * @property {(params:{withdrawalId:string, providerRef:string}) => Promise<void>} cancelWithdrawal
 * @property {(rawBody:Buffer, signatureHeader:string) => boolean} verifyWebhookSignature
 * @property {(payload:object) => {type:string, data:object}} parseWebhookEvent
 */

/** @returns {CustodyProvider} */
function loadProvider() {
  const kind = process.env.CUSTODY_PROVIDER || 'mock';
  if (kind === 'mock') return require('./mockProvider');
  if (kind === 'fireblocks') return require('./fireblocksProvider');
  throw new Error(`Prestataire de custody inconnu: ${kind}`);
}

module.exports = { loadProvider };
