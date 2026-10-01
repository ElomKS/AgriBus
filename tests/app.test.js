import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../index.js';
import { createUser, deleteUser, getUserByUsername } from '../db.js';

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