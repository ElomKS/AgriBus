# AgriBus
Site statique vitrine de la boutique fermière Maison Agri.

Cette branche est préparée pour un déploiement sur GitHub Pages avec des pages HTML statiques.

## Déploiement GitHub Pages

1. Sélectionne la branche `dev` dans les paramètres GitHub Pages.
2. Choisis le répertoire racine (`/`) comme source de publication.
3. Le site sera servi depuis `https://<utilisateur>.github.io/AgriBus`.

## Pages statiques disponibles

- `index.html` : page d’accueil
- `histoire.html` : page de présentation
- `produits.html` : catalogue des produits
- `acheter.html` : page d’achat statique
- `contact.html` : page de contact
- `404.html` : page d’erreur pour GitHub Pages

## Ressources

- `public/styles/main.css` : feuille de style
- `public/images/` : images des produits

## Notes

- Le site est statique et ne contient pas de serveur Express ni de formulaire fonctionnel.
- Les demandes de contact et de commande sont proposées sous forme de liens vers l’email.
- Les fichiers SQLite locaux sont ignorés par Git dans `.gitignore`.
