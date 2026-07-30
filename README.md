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

## Notes

- L'application utilise une base de données SQLite locale.
- Les fichiers SQLite locaux sont exclus de Git via `.gitignore`.
