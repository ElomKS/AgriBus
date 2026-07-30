import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../index.js';

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

test('POST /send-message stores a contact message and shows a success flash', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/send-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Alice&email=alice@example.com&message=Bonjour'
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /Merci/i);
});

test('GET /produits filters products by search query', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/produits?search=tom`);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /Tomates/i);
});
