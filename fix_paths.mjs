import db from './db.js';

const stmt = db.prepare('UPDATE products SET image = ? WHERE id = ?');
stmt.run('./images/volailes.avif', 8);
stmt.run('./images/tilapia.avif', 7);

const items = db.prepare('SELECT id, nom, image FROM products ORDER BY id').all();
for (const p of items) {
  console.log(p.id + ' ' + p.nom + ' ' + p.image);
}
