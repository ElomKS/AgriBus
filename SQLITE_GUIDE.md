# Guide SQLite pour AgriBus

## Objectif

Nous avons remplacé le stockage temporaire par une base de données SQLite locale.

Cela permet de conserver les informations importantes de votre application, comme :
- les produits
- leur prix
- leur description
- leur stock
- les messages de contact

## Pourquoi SQLite ?

SQLite est un bon choix pour commencer parce qu’il est :
- gratuit
- simple à utiliser
- local
- adapté aux petits projets

## Ce que vous avez maintenant

Votre projet utilise maintenant :
- une base SQLite locale
- un fichier de base de données nommé agribus.db
- un fichier de code nommé db.js pour gérer la base

## Fichiers importants

### 1. db.js
Ce fichier sert à :
- ouvrir la base de données
- créer les tables
- insérer les produits de départ
- enregistrer les messages de contact

### 2. index.js
Ce fichier utilise la base de données pour :
- afficher les produits
- rechercher des produits
- enregistrer les messages du formulaire de contact

### 3. agribus.db
C’est le fichier réel de la base de données.
Il contient les données enregistrées.

## Les tables principales

### Table products
Cette table contient les produits.

Colonnes :
- id : identifiant unique
- nom : nom du produit
- prix : prix du produit
- image : chemin de l’image
- description : description du produit
- stock : quantité disponible

### Table contact_messages
Cette table contient les messages de contact.

Colonnes :
- id : identifiant unique
- name : nom de la personne
- email : adresse email
- message : contenu du message
- created_at : date de création

## Comment fonctionne le processus

### Quand le serveur démarre
1. la base est ouverte
2. les tables sont vérifiées
3. si elles n’existent pas, elles sont créées
4. si la table produits est vide, les produits de base sont insérés

### Quand un utilisateur envoie un message de contact
1. le navigateur envoie les données
2. le serveur récupère les données
3. le serveur les enregistre dans la base SQLite
4. la donnée reste disponible même après un redémarrage

## Ce que cela change par rapport à avant

Avant :
- les données étaient stockées temporairement en mémoire
- elles disparaissaient quand le serveur redémarrait

Maintenant :
- les données sont stockées durablement dans la base SQLite
- elles restent accessibles plus longtemps

## Concept important à retenir

- le code dit quoi faire
- la base de données garde les informations

## Résumé simple

SQLite est une base de données locale très simple pour apprendre.
Elle est parfaite pour votre projet de boutique en ligne.

Vous pouvez maintenant stocker :
- les produits
- les prix
- les messages de contact

sans avoir besoin d’un serveur distant compliqué.
