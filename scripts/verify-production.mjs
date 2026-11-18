// Creates one verification user and one score; does not delete production data.
// Keep the password and session token in memory, never in command arguments/logs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const ec2 = process.argv.includes('--ec2');
const base = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'https://simon.sugarsantillan.com';
const email = `cs260-verification-${randomUUID()}@example.invalid`;
const password = randomUUID();
let cookie;
async function request(path, method = 'GET', body, status = 200) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, status, `${method} ${path}`);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return status === 204 ? null : response.json();
}
await request('/scores', 'GET', undefined, 401);
await request('/auth/create', 'POST', { email, password });
console.log('PASS registration');
await request('/auth/logout', 'DELETE', undefined, 204);
cookie = undefined;
await request('/auth/login', 'POST', { email, password: randomUUID() }, 401);
await request('/auth/login', 'POST', { email, password });
console.log('PASS login and incorrect-password rejection');
const score = { name: email, score: 1, date: new Date().toLocaleDateString('en-US') };
await request('/score', 'POST', score);
assert.ok(Array.isArray(await request('/scores')));
console.log('PASS score submission and authenticated leaderboard');
if (ec2) {
  const require = createRequire(`${process.env.HOME}/services/simon/package.json`);
  const { MongoClient } = require('mongodb');
  const config = require('./dbConfig.json');
  const bcrypt = require('bcryptjs');
  const uri = `mongodb+srv://${encodeURIComponent(config.userName)}:${encodeURIComponent(config.password)}@${config.hostname}`;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const db = client.db('simon');
    const user = await db.collection('user').findOne({ email });
    assert.ok(user);
    assert.notEqual(user.password, password);
    assert.ok(await bcrypt.compare(password, user.password));
    assert.ok(await db.collection('score').findOne({ name: email, score: 1 }));
    console.log('PASS direct Atlas reads: user with hashed password and saved score');
    execFileSync('pm2', ['restart', 'simon'], { stdio: 'ignore' });
    let ready = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'Simon becomes ready after restart');
    // Keep the pre-restart session to prove the auth token is stored in Atlas.
    assert.ok(Array.isArray(await request('/scores')));
    await request('/auth/logout', 'DELETE', undefined, 204);
    cookie = undefined;
    await request('/auth/login', 'POST', { email, password });
    assert.ok(await db.collection('score').findOne({ name: email, score: 1 }));
    assert.ok(Array.isArray(await request('/scores')));
    console.log('PASS session, login, and saved score persist across PM2 restart');
  } finally {
    await client.close();
  }
}
await request('/auth/logout', 'DELETE', undefined, 204);
cookie = undefined;
await request('/scores', 'GET', undefined, 401);
console.log('PASS logout and restricted access');
// Without --ec2, separately confirm this record in Atlas; top ten may omit a score of 1.
console.log(`Verification record: ${email}`);
