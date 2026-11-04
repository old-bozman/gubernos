// Turning away a client that keeps trying without the code: behind our Cloudflare Tunnel it's counted by CF-Connecting-IP,
// so rotating X-Forwarded-For doesn't escape the limit. Without a tunnel that header means nothing (anyone can send it).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';

const servers = [];
after(async () => { for (const s of servers) await s.stop(); });
async function hammer(tunnel, ip = '203.0.113.7') {
  const s = await startServer(); servers.push(s);
  await fetch(`${s.url}/api/pair`);
  const f = path.join(s.dir, 'data', 'pair.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), required: true }));
  if (tunnel) fs.writeFileSync(path.join(s.dir, 'config', 'tunnel.json'), '{}');
  let last;
  for (let i = 0; i < 32; i++) last = (await fetch(`${s.proxyUrl}/api/state`, { headers: { 'x-forwarded-for': `198.51.100.${i}`, 'cf-connecting-ip': ip } })).status;
  return last;
}
test('through the tunnel: rotating X-Forwarded-For is still one client, turned away', async () => {
  assert.equal(await hammer(true), 429);
});
test('without a tunnel: CF-Connecting-IP is ignored, a forged one can\'t lock someone out', async () => {
  assert.equal(await hammer(false), 401);
});
