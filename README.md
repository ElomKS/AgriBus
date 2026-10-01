# AgriBus
Application de boutique en ligne pour produits fermiers

AgriBus permet aux clients de parcourir des produits agricoles, d'ajouter des articles à leur panier et de finaliser une commande en CFA. Le site utilise **Express** et **EJS** pour le rendu côté serveur et gère le panier via des sessions utilisateur.

## Usage

1. Installer les dépendances

```bash
npm install
```

2. Démarrer l'application en mode production

```bash
npm start
```

3. Démarrer l'application en mode développement (auto-rechargement)

```bash
npm run dev
```

4. Ouvrir le site dans le navigateur

```text
http://localhost:3000
```

## Notifications par email (Brevo)

À chaque commande, deux emails partent via l'API Brevo : un pour l'administrateur
et un de confirmation pour le client. Un envoi qui échoue **n'empêche jamais** la
commande d'être enregistrée.

| Variable | Rôle | Obligatoire |
| --- | --- | --- |
| `BREVO_API_KEY` | Clé API Brevo (format `xkeysib-...`) | Oui pour l'envoi |
| `ADMIN_EMAIL` | Destinataire des notifications, séparés par des virgules | Oui pour l'envoi |
| `MAIL_FROM` | Adresse expéditeur (doit être **vérifiée** dans Brevo) | Oui pour l'envoi |
| `MAIL_FROM_NAME` | Nom affiché à l'expéditeur, `Kekeli Ferme` par défaut | Non |

Sans `BREVO_API_KEY`, l'envoi est simplement désactivé et l'application
fonctionne normalement (utile en développement local).

## Suivi des commandes

La page `/admin/commandes` liste les commandes avec leur statut. Le bouton
**Commandes** du tableau de bord affiche un badge rouge sur le nombre de
commandes restées « Nouvelle ». Le statut évolue ensuite vers `Traitée`,
`Livrée` ou `Annulée`.

## Notes

- L'application utilise une base de données SQLite locale.
- Les fichiers SQLite locaux sont exclus de Git via `.gitignore`.
