#!/usr/bin/env node
// npm test: node --test under a deadline. A test process that dies halfway through a message leaves node's runner spinning for
// ever in its output parser (--test-timeout can't reach it: that loop never yields), and a hung run blocks a release silently.
// So the whole run has a limit: past it, everything is killed and the run fails, saying why.
//   node tests/run.mjs [files…]     default: every tests/*.test.js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2);
if (!files.length) for (const f of fs.readdirSync(HERE).sort()) if (f.endsWith('.test.js')) files.push(path.join(HERE, f));
const LIMIT = Number(process.env.GUBERNOS_TEST_LIMIT_MS) || 5 * 60 * 1000;

const child = spawn(process.execPath, ['--test', '--test-timeout=120000', ...files], { stdio: 'inherit', detached: true });
const killAll = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
process.once('SIGINT', () => { killAll(); process.exit(130); });
process.once('SIGTERM', () => { killAll(); process.exit(143); });
const timer = setTimeout(() => {
  console.error(`\n✗ the test run was still going after ${Math.round(LIMIT / 1000)} s: stopped it, this counts as a failure`);
  killAll();
  process.exit(1);
}, LIMIT);
child.on('exit', (code, signal) => { clearTimeout(timer); process.exit(code ?? (signal ? 1 : 0)); });
