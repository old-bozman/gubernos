// The Mac's Focus with the Focus view (Settings → Today → Mac Focus): macOS has no command for Focus modes, so two
// Shortcuts made once in the Shortcuts app do it — "Gubernos Focus On" (Set Focus: a Focus, e.g. Work or Do Not Disturb,
// turned On) and "Gubernos Focus Off" (turned Off). The server runs them when the Focus view is switched, from any device.
// GUBERNOS_MAC_FOCUS=0 (the test server) only logs what it would run.
import { execFile } from 'node:child_process';
import { APP_NAME } from './config.js';

export const ON = `${APP_NAME} Focus On`, OFF = `${APP_NAME} Focus Off`;
const DRY = process.env.GUBERNOS_MAC_FOCUS === '0';
const run = (args) => new Promise((res) => execFile('/usr/bin/shortcuts', args, { timeout: 30000 }, (e, out) => res(e ? null : String(out))));

// {available, missing: [shortcut names not made yet]}
export async function state() {
  if (process.platform !== 'darwin') return { available: false, missing: [] };
  const out = await run(['list']);
  if (out == null) return { available: false, missing: [] };
  const names = new Set(out.split('\n').map((s) => s.trim()));
  return { available: true, missing: [ON, OFF].filter((n) => !names.has(n)), on: ON, off: OFF };
}

export async function set(on) {
  const name = on ? ON : OFF;
  if (process.platform !== 'darwin') return; // the iPhone's offline mode runs this file too
  if (DRY) return console.log(`[mac-focus] would run "${name}"`);
  const out = await run(['run', name]);
  console.log(`[mac-focus] ${name}: ${out == null ? 'failed (is the shortcut there?)' : 'ok'}`);
}
