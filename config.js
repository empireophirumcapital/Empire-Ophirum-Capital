// Ces constantes DOIVENT rester cohérentes avec WALLET_CFG / NETS / ASSET_NETS
// dans eoc-exchange-complete-6.html, pour que les regles cote client et
// cote serveur ne divergent jamais (le serveur reste la seule autorite).

const NETS = {
  TRC20: { conf: 20, rx: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
  BEP20: { conf: 15, rx: /^0x[a-fA-F0-9]{40}$/ },
  ERC20: { conf: 12, rx: /^0x[a-fA-F0-9]{40}$/ },
  BTC:   { conf: 3,  rx: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ },
  SOL:   { conf: 32, rx: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
};

const ASSET_NETS = {
  USDT: { nets: ['TRC20', 'BEP20', 'ERC20'], min: 20 },
  BTC:  { nets: ['BTC'], min: 0.0005 },
  ETH:  { nets: ['ERC20'], min: 0.01 },
  SOL:  { nets: ['SOL'], min: 0.1 },
  BNB:  { nets: ['BEP20'], min: 0.01 },
};

const RULES = {
  dailyLimit: Number(process.env.DAILY_LIMIT || 10000),
  reviewThreshold: Number(process.env.REVIEW_THRESHOLD || 5000),
  addrDelayMs: Number(process.env.ADDR_DELAY_MS || 24 * 3600 * 1000),
  minDepositValue: Number(process.env.MIN_DEPOSIT_VALUE || 10),
};

function isValidAddress(network, address) {
  const net = NETS[network];
  return !!net && net.rx.test(address || '');
}

function isSupportedPair(asset, network) {
  const a = ASSET_NETS[asset];
  return !!a && a.nets.includes(network);
}

module.exports = { NETS, ASSET_NETS, RULES, isValidAddress, isSupportedPair };
