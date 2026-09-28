import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sur un hebergeur avec disque persistant (ex: Render), definir DATA_DIR
// vers le chemin monte (ex: /var/data) pour conserver la base entre les deploiements.
// Si le chemin est inaccessible, on replie sur le dossier du projet plutot que de crasher.
let dataDir = process.env.DATA_DIR || __dirname;
try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
} catch (err) {
    console.warn(`[KEKELI] DATA_DIR "${dataDir}" inaccessible (${err.code}) — repli sur ${__dirname}. Les donnees ne seront pas conservees au redemarrage.`);
    dataDir = __dirname;
}
const db = new Database(path.join(dataDir, 'agribus.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    prix REAL NOT NULL,
    image TEXT NOT NULL,
    description TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

export function getProducts() {
  return db.prepare('SELECT * FROM products ORDER BY id').all();
}

export function seedProducts() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (count > 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO products (nom, prix, image, description, stock)
    VALUES (?, ?, ?, ?, ?)
  `);

  const products = [
    { nom: 'Laitues', prix: 3.50, image: './images/laitue.jpg', description: 'Laitues fraîches cultivées biologiquement', stock: 25 },
    { nom: 'Tomates', prix: 5.75, image: './images/tomate.png', description: 'Tomates juteuses et savoureuses', stock: 30 },
    { nom: 'Betteraves', prix: 4.25, image: './images/Beetroot.png', description: 'Betteraves rouges fraîches', stock: 20 },
    { nom: 'Concombres', prix: 2.80, image: './images/cucumbers.png', description: 'Concombres croquants', stock: 15 },
    { nom: 'Oignons', prix: 3.20, image: './images/onion.png', description: 'Oignons parfumés de notre terre', stock: 40 },
    { nom: 'Carottes', prix: 3.75, image: './images/carrotte1.jpeg', description: 'Carottes douces et nutritives', stock: 35 },
    { nom: 'Poissons', prix: 12.50, image: './images/tilapia.jpg', description: 'Poissons frais d’élevage durable', stock: 8 },
    { nom: 'Poulets', prix: 15.00, image: './images/volailes.jpg', description: 'Poulets fermiers élevés au grain', stock: 5 },
    { nom: 'Œufs', prix: 6.25, image: './images/oeuf.jpg', description: 'Œufs frais de nos poules élevées au sol', stock: 50 }
  ];

  const insertMany = db.transaction((rows) => {
    for (const product of rows) {
      insert.run(product.nom, product.prix, product.image, product.description, product.stock);
    }
  });

  insertMany(products);
}

export function addContactMessage(name, email, message) {
  const stmt = db.prepare(`
    INSERT INTO contact_messages (name, email, message)
    VALUES (?, ?, ?)
  `);
  return stmt.run(name, email, message);
}

export function getContactMessages() {
  return db.prepare('SELECT * FROM contact_messages ORDER BY id DESC').all();
}

export function deleteContactMessage(id) {
  const stmt = db.prepare('DELETE FROM contact_messages WHERE id = ?');
  return stmt.run(id);
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

export function listUsers() {
  return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY role, username').all();
}

export function getUserById(id) {
  return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
}

export function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
}

export function changeUserPassword(id, password) {
  const stmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  return stmt.run(hashPassword(password), id);
}

export function deleteUser(id) {
  const stmt = db.prepare('DELETE FROM users WHERE id = ?');
  return stmt.run(id);
}

export function authenticateUser(username, password) {
  const user = getUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, username: user.username, role: user.role };
}

export function createUser(username, password, role = 'staff') {
  const stmt = db.prepare(`
    INSERT INTO users (username, password_hash, role)
    VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      role = excluded.role
  `);
  return stmt.run(username, hashPassword(password), role);
}

// ============ AVIS CLIENTS ============
export function addReview(author, rating, comment) {
  const stmt = db.prepare(`
    INSERT INTO reviews (author, rating, comment, status)
    VALUES (?, ?, ?, 'pending')
  `);
  return stmt.run(author, rating, comment);
}

export function getApprovedReviews() {
  return db.prepare("SELECT * FROM reviews WHERE status = 'approved' ORDER BY created_at DESC, id DESC").all();
}

export function getAllReviews() {
  return db.prepare(`
    SELECT * FROM reviews
    ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC
  `).all();
}

export function getReviewStats() {
  const row = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average
    FROM reviews WHERE status = 'approved'
  `).get();
  return {
    count: row.count,
    average: row.average ? Math.round(row.average * 10) / 10 : 0
  };
}

export function countPendingReviews() {
  return db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE status = 'pending'").get().count;
}

export function setReviewStatus(id, status) {
  const stmt = db.prepare('UPDATE reviews SET status = ? WHERE id = ?');
  return stmt.run(status, id);
}

export function deleteReview(id) {
  const stmt = db.prepare('DELETE FROM reviews WHERE id = ?');
  return stmt.run(id);
}

export default db;
