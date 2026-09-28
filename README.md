# EOC Wallet Backend (squelette mode live)

Backend Node.js/Express + SQLite qui implémente les 4 endpoints attendus par
`eoc-exchange-complete-6.html` quand `WALLET_CFG.mode = 'live'` :

- `POST /api/wallet/deposit-address`
- `POST /api/wallet/withdrawals`
- `POST /api/wallet/withdrawals/:id/cancel`
- `GET  /api/wallet/state`

Plus les routes nécessaires autour : `POST /api/auth/register`,
`POST /api/auth/login`, `POST /api/webhooks/custody`.

## Démarrage rapide (mode dev / mock)

```bash
cp .env.example .env
npm install
npm run dev
```

Par défaut `CUSTODY_PROVIDER=mock` : le serveur tourne, génère de fausses
adresses et simule des retraits instantanés. **Aucun fond réel n'est
manipulé.** C'est fait pour tester toute la mécanique (auth, ledger, règles
métier, endpoints) avant de brancher un vrai prestataire.

## Brancher le frontend

Dans `eoc-exchange-complete-6.html`, autour de la ligne 1518 :

```js
const WALLET_CFG = {
  mode: 'live',
  apiBase: 'http://localhost:4000/api/wallet',
  // ...
};
```

Il faudra aussi que le frontend envoie le token JWT (reçu de
`/api/auth/login`) dans le header `Authorization: Bearer <token>` sur
chaque appel — ce n'est pas encore géré dans le fichier HTML actuel, qui n'a
pas de vraie session serveur.

## Architecture

- **`src/ledger.js`** — moteur de ledger en double écriture. C'est la seule
  source de vérité des soldes ; aucune route ne modifie `balances`
  directement. Un compte `USER:*` ne peut jamais passer négatif.
- **`src/providers/`** — interface `CustodyProvider` + deux implémentations :
  - `mockProvider.js` : fausses adresses/retraits, pour dev/tests.
  - `fireblocksProvider.js` : **squelette non fonctionnel**, à compléter
    avec le SDK du prestataire réellement choisi (Fireblocks, BitGo,
    Copper...). Tous les `TODO` sont dans ce fichier.
- **`src/routes/webhooks.js`** — reçoit les événements du prestataire
  (dépôt confirmé, statut de retrait). C'est par là qu'arrivent les *vrais*
  dépôts, jamais par polling côté client.
- **`src/routes/wallet.js`** — les 4 endpoints, avec règles anti-fraude de
  base (limite journalière, seuil de revue manuelle, vérification d'adresse).

## Ce qui reste à faire avant toute mise en production réelle

Ce squelette couvre la plomberie logicielle. Il ne couvre PAS :

1. **Choisir et contracter avec un prestataire de custody** (Fireblocks,
   BitGo, Copper, Anchorage...) et compléter `fireblocksProvider.js` avec
   leur SDK/API réels, en suivant leur documentation à jour.
2. **KYC/AML** — vérification d'identité obligatoire avant d'autoriser
   dépôts/retraits réels. Généralement via un prestataire dédié (Sumsub,
   Onfido, Jumio...), non inclus ici.
3. **2FA réel** — `twoFaCode`/`emailCode` sont vérifiés de façon triviale
   dans `routes/wallet.js` (`TODO` explicite). Implémenter TOTP
   (`otplib` par ex.) et un vrai envoi/vérification de code email.
4. **Conformité réglementaire** — selon votre juridiction, opérer un
   exchange qui détient des fonds clients nécessite très probablement un
   agrément (VASP/MSB/etc.), des obligations de reporting, de ségrégation
   des fonds clients, d'audits de sécurité réguliers. C'est un sujet
   juridique, pas seulement technique — à faire valider par un avocat
   spécialisé avant tout lancement.
5. **Sécurité infra** — ce squelette n'a pas de rate limiting, pas de
   détection de fraude, pas de rotation de secrets, pas de logs d'audit
   inaltérables. Pour un système qui manipule de l'argent réel, un audit de
   sécurité externe est fortement recommandé avant mise en production.
6. **SQLite → base de données de production** — SQLite convient très bien
   pour développer et tester, mais pour de l'argent réel en production,
   PostgreSQL (avec sauvegardes, réplication, verrouillage transactionnel
   robuste sous forte charge) est recommandé.

En résumé : ce dépôt vous donne une base saine et fonctionnelle pour
développer et tester la mécanique de wallet — le passage à de l'argent réel
nécessite ensuite un vrai prestataire de custody, un vrai KYC, une revue
juridique et un audit de sécurité.
