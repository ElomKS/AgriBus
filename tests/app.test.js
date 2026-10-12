import test from 'node:test';
import assert from 'node:assert/strict';
import { app, resetRateLimits } from '../index.js';
import { createUser, deleteUser, getUserByUsername, getAllProducts, getProductById, deleteProduct } from '../db.js';

let server;
let port;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function base(path) {
  return `http://127.0.0.1:${port}${path}`;
}

async function newSession() {
  // Ouvre une session (cookie) et extrait le jeton CSRF d'un formulaire
  const res = await fetch(base('/produits'));
  const html = await res.text();
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  const token = html.match(/name="csrfToken" value="([^"]+)"/)?.[1];
  assert.ok(cookie, 'la session doit definir un cookie');
  assert.ok(token, 'les formulaires doivent contenir un jeton CSRF');
  return { cookie, token };
}

function form(entries) {
  return new URLSearchParams(entries).toString();
}

test('POST /send-message stores a contact message and shows a success flash', async () => {
  const { cookie, token } = await newSession();
  const response = await fetch(base('/send-message'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: form({ name: 'Alice', email: 'alice@example.com', message: 'Bonjour', csrfToken: token })
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /Merci/i);
});

test('POST without a CSRF token is rejected with 403', async () => {
  const response = await fetch(base('/send-message'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ name: 'Bob', email: 'bob@example.com', message: 'Salut' })
  });

  assert.equal(response.status, 403);
});

test('checkout persists the order and shows a confirmation page', async () => {
  const { cookie, token } = await newSession();

  const add = await fetch(base('/panier/add'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: form({ productId: '1', quantity: '2', csrfToken: token }),
    redirect: 'manual'
  });
  assert.equal(add.status, 302);

  const checkout = await fetch(base('/checkout'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: form({
      nom: 'Client Test',
      email: 'client@test.com',
      telephone: '+22890000000',
      adresse: 'Avagome, Togo',
      deliveryMethod: 'home',
      paymentMethod: 'cash',
      csrfToken: token
    }),
    redirect: 'manual'
  });
  assert.equal(checkout.status, 302);
  const location = checkout.headers.get('location');
  assert.match(location, /^\/confirmation\/KF-/);

  const confirmation = await fetch(base(location), { headers: { cookie } });
  const text = await confirmation.text();
  assert.equal(confirmation.status, 200);
  assert.match(text, /Merci/i);
  assert.match(text, /Client Test/i);
});

test('an unknown order reference returns 404', async () => {
  const response = await fetch(base('/confirmation/KF-inconnue'));
  assert.equal(response.status, 404);
});

// Cree une commande de test et renvoie { reference, cookie, token }
async function placeOrder(nom) {
  const { cookie, token } = await newSession();

  await fetch(base('/panier/add'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: form({ productId: '1', quantity: '1', csrfToken: token }),
    redirect: 'manual'
  });

  const checkout = await fetch(base('/checkout'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: form({
      nom,
      email: 'client@test.com',
      telephone: '+22890000000',
      adresse: 'Avagome, Togo',
      deliveryMethod: 'home',
      paymentMethod: 'cash',
      csrfToken: token
    }),
    redirect: 'manual'
  });

  const reference = checkout.headers.get('location').split('/').pop();
  return { reference, cookie, token };
}

test('/admin/commandes est reserve a un utilisateur connecte', async () => {
  const response = await fetch(base('/admin/commandes'), { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^\/admin/);
});

test('la commande passee apparait dans l admin et peut changer de statut', async () => {
  const username = `tmp_cmd_${Date.now()}`;
  const password = 'MdpTest123!';
  createUser(username, password, 'admin');

  try {
    const { reference } = await placeOrder('Client Admin Test');
    assert.ok(reference.startsWith('KF-'), 'la commande doit avoir une reference');

    // Connexion en admin
    const loginPage = await fetch(base('/admin'));
    const cookie = loginPage.headers.get('set-cookie').split(';')[0];
    const token = (await loginPage.text()).match(/name="csrfToken" value="([^"]+)"/)[1];

    const login = await fetch(base('/admin/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: form({ username, password, csrfToken: token }),
      redirect: 'manual'
    });
    assert.equal(login.status, 302);
    const adminCookie = login.headers.get('set-cookie').split(';')[0];

    // Le tableau de bord affiche le badge des commandes
    const dash = await fetch(base('/admin'), { headers: { cookie: adminCookie } });
    const dashText = await dash.text();
    assert.match(dashText, /Commandes/);
    assert.match(dashText, /badge bg-danger/, 'le badge des nouvelles commandes doit etre affiche');

    // La page commandes liste la commande passee
    const page = await fetch(base('/admin/commandes'), { headers: { cookie: adminCookie } });
    const text = await page.text();
    assert.equal(page.status, 200);
    assert.ok(text.includes(reference), 'la commande doit figurer dans la liste');
    assert.match(text, /Client Admin Test/);

    // Changement de statut
    const idMatch = text.match(new RegExp(`name="id" value="(\\d+)"[\\s\\S]*?${reference}`));
    const orderId = idMatch ? idMatch[1] : text.match(new RegExp(`value="(\\d+)"[^>]*>[\\s\\S]*?${reference}`))?.[1];

    const statusRes = await fetch(base('/admin/commandes/statut'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: adminCookie },
      body: form({ id: orderId || '1', status: 'traitee', csrfToken: token }),
      redirect: 'manual'
    });
    assert.equal(statusRes.status, 302);

    const after = await fetch(base('/admin/commandes'), { headers: { cookie: adminCookie } });
    const afterText = await after.text();
    assert.ok(afterText.includes(reference));
  } finally {
    const u = getUserByUsername(username);
    if (u) deleteUser(u.id);
  }
});

test('un statut de commande invalide est rejete', async () => {
  const username = `tmp_cmd2_${Date.now()}`;
  const password = 'MdpTest123!';
  createUser(username, password, 'admin');

  try {
    const loginPage = await fetch(base('/admin'));
    const cookie = loginPage.headers.get('set-cookie').split(';')[0];
    const token = (await loginPage.text()).match(/name="csrfToken" value="([^"]+)"/)[1];

    const login = await fetch(base('/admin/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: form({ username, password, csrfToken: token }),
      redirect: 'manual'
    });
    const adminCookie = login.headers.get('set-cookie').split(';')[0];

    const res = await fetch(base('/admin/commandes/statut'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: adminCookie },
      body: form({ id: '1', status: 'statut_bidon', csrfToken: token }),
      redirect: 'manual'
    });
    assert.equal(res.status, 302);

    const page = await fetch(base('/admin/commandes'), { headers: { cookie: adminCookie } });
    const text = await page.text();
    assert.match(text, /Statut invalide/, 'un statut hors liste doit etre refuse');
  } finally {
    const u = getUserByUsername(username);
    if (u) deleteUser(u.id);
  }
});

test('GET /produits filters products by search query', async () => {
  const response = await fetch(base('/produits?search=tom'));
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /Tomates/i);
});

test('session cookie is HttpOnly and expires after two hours', async () => {
  const res = await fetch(base('/'));
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);

  const expires = setCookie.match(/Expires=([^;]+)/);
  assert.ok(expires, 'le cookie doit avoir une date d\'expiration');
  const delta = new Date(expires[1]).getTime() - Date.now();
  assert.ok(
    delta > 7100 * 1000 && delta <= 7300 * 1000,
    `expiration attendue ~2h, obtenue ${Math.round(delta / 1000)}s`
  );
});

test('admin login regenerates the session id (anti-fixation) and grants access', async () => {
  const username = `tmp_${Date.now()}`;
  const password = 'MdpTest123!';
  createUser(username, password, 'staff');

  try {
    // Session anonyme + jeton CSRF (page de login)
    const loginPage = await fetch(base('/admin'));
    const html = await loginPage.text();
    const cookie = loginPage.headers.get('set-cookie').split(';')[0];
    const token = html.match(/name="csrfToken" value="([^"]+)"/)[1];

    // Login
    const res = await fetch(base('/admin/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: form({ username, password, csrfToken: token }),
      redirect: 'manual'
    });
    assert.equal(res.status, 302);

    // L'ID de session DOIT changer apres authentification
    const newCookie = res.headers.get('set-cookie').split(';')[0];
    assert.notEqual(newCookie, cookie, "l'ID de session doit changer apres le login");

    // La session post-login donne bien acces a l'administration
    const dash = await fetch(base('/admin'), { headers: { cookie: newCookie } });
    const dashText = await dash.text();
    assert.equal(dash.status, 200);
    assert.match(dashText, /Messages de contact/);
  } finally {
    const u = getUserByUsername(username);
    if (u) deleteUser(u.id);
  }
});

test('admin login is rate limited after repeated failed attempts', async () => {
  const page = await fetch(base('/admin'));
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const token = (await page.text()).match(/name="csrfToken" value="([^"]+)"/)[1];

  let firstStatus = 0;
  let lastStatus = 0;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(base('/admin/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: form({ username: 'inexistant', password: 'mauvais', csrfToken: token }),
      redirect: 'manual'
    });
    if (i === 0) firstStatus = res.status;
    lastStatus = res.status;
  }
  assert.equal(firstStatus, 401, 'les premieres tentatives doivent etre des echecs d\'authentification');
  assert.equal(lastStatus, 429, 'le rate limit doit bloquer apres plusieurs tentatives');
});

// ============ ADMIN - GESTION DES PRODUITS ============

async function adminSession() {
  resetRateLimits();
  const username = `tmp_prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const password = 'MdpTest123!';
  createUser(username, password, 'admin');

  const loginPage = await fetch(base('/admin'));
  const cookie = loginPage.headers.get('set-cookie').split(';')[0];
  const token = (await loginPage.text()).match(/name="csrfToken" value="([^"]+)"/)[1];

  const login = await fetch(base('/admin/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: form({ username, password, csrfToken: token }),
    redirect: 'manual'
  });
  assert.equal(login.status, 302);

  return {
    cookie: login.headers.get('set-cookie').split(';')[0],
    token,
    username
  };
}

test('la gestion des produits est reservee aux administrateurs', async () => {
  const res = await fetch(base('/admin/produits'), { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/admin/);
});

test('un administrateur peut ajouter, modifier, masquer puis supprimer un produit', async () => {
  const admin = await adminSession();
  const nom = `ProduitTest${Date.now()}`;
  let productId = null;

  try {
    // --- Ajout ---
    const create = await fetch(base('/admin/produits/create'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: admin.cookie },
      body: form({
        nom,
        prix: '1500',
        stock: '12',
        unite: 'kg',
        image: './images/tomate.png',
        description: 'Produit de test',
        csrfToken: admin.token
      }),
      redirect: 'manual'
    });
    assert.equal(create.status, 302);

    const created = getAllProducts().find((p) => p.nom === nom);
    assert.ok(created, 'le produit doit exister en base apres creation');
    assert.equal(created.prix, 1500);
    assert.equal(created.actif, 1, 'un nouveau produit est actif par defaut');
    productId = created.id;

    // Il apparait dans le catalogue public
    const catalogue = await (await fetch(base('/produits'))).text();
    assert.ok(catalogue.includes(nom), 'le produit actif doit apparaitre dans le catalogue');

    // --- Modification ---
    const update = await fetch(base(`/admin/produits/update/${productId}`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: admin.cookie },
      body: form({
        nom,
        prix: '2750',
        stock: '5',
        unite: 'plateau',
        image: './images/tomate.png',
        description: 'Description modifiee',
        csrfToken: admin.token
      }),
      redirect: 'manual'
    });
    assert.equal(update.status, 302);
    const updated = getProductById(productId);
    assert.equal(updated.prix, 2750);
    assert.equal(updated.unite, 'plateau');
    assert.equal(updated.stock, 5);

    // --- Masquage ---
    const toggle = await fetch(base(`/admin/produits/toggle/${productId}`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: admin.cookie },
      body: form({ csrfToken: admin.token }),
      redirect: 'manual'
    });
    assert.equal(toggle.status, 302);
    assert.equal(getProductById(productId).actif, 0, 'le produit doit etre masque');

    const catalogueAfter = await (await fetch(base('/produits'))).text();
    assert.ok(!catalogueAfter.includes(nom), 'un produit masque ne doit plus apparaitre au catalogue');

    // Visible cote admin malgre le masquage
    const adminPage = await (await fetch(base('/admin/produits'), { headers: { cookie: admin.cookie } })).text();
    assert.ok(adminPage.includes(nom), 'un produit masque reste visible dans l administration');

    // --- Suppression ---
    const del = await fetch(base(`/admin/produits/delete/${productId}`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: admin.cookie },
      body: form({ csrfToken: admin.token }),
      redirect: 'manual'
    });
    assert.equal(del.status, 302);
    assert.equal(getProductById(productId), undefined, 'le produit doit etre supprime');
    productId = null;
  } finally {
    if (productId) deleteProduct(productId);
    const u = getUserByUsername(admin.username);
    if (u) deleteUser(u.id);
  }
});

test('une creation de produit invalide est refusee (prix negatif)', async () => {
  const admin = await adminSession();
  try {
    const create = await fetch(base('/admin/produits/create'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: admin.cookie },
      body: form({
        nom: 'ProduitInvalide',
        prix: '-10',
        stock: '1',
        unite: 'kg',
        image: './images/tomate.png',
        description: 'invalide',
        csrfToken: admin.token
      }),
      redirect: 'manual'
    });
    assert.equal(create.status, 302);
    assert.equal(getAllProducts().find((p) => p.nom === 'ProduitInvalide'), undefined);
  } finally {
    const u = getUserByUsername(admin.username);
    if (u) deleteUser(u.id);
  }
});