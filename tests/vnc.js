// Eyes and hands on a test VM's real screen, over its VNC server, no dependencies: what's actually shown (a dialog, a stuck window)
// can't be seen over SSH. connect(url) → {width, height, screenshot(file), click(x, y), doubleClick(x, y), type(text), close}.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import zlib from 'node:zlib';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.concat([Buffer.from(type), data]), o = Buffer.alloc(8); o.writeUInt32BE(data.length, 0); const e = Buffer.alloc(4); e.writeUInt32BE(crc32(t)); return Buffer.concat([o.subarray(0, 4), t, e]); };
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 3 })), chunk('IEND', Buffer.alloc(0))]);
}
// VNC's password check: DES with each key byte's bits reversed (triple DES with one key repeated is the same thing)
function answer(password, challenge) {
  const key = Buffer.alloc(8);
  Buffer.from(password).subarray(0, 8).forEach((b, i) => { let r = 0; for (let k = 0; k < 8; k++) if (b & (1 << k)) r |= 128 >> k; key[i] = r; });
  const c = crypto.createCipheriv('des-ede3', Buffer.concat([key, key, key]), null); c.setAutoPadding(false);
  return Buffer.concat([c.update(challenge), c.final()]);
}

export async function connect(url) {
  const u = new URL(url);
  const sock = net.connect(Number(u.port), u.hostname);
  let buf = Buffer.alloc(0), wake = null, failure = null;
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); wake?.(); });
  const die = (e) => { failure = e; wake?.(); };
  sock.on('error', die); sock.on('close', () => die(new Error('the VNC connection closed')));
  const need = async (n, ms = 30000) => {
    const end = Date.now() + ms;
    while (buf.length < n) {
      if (failure) throw failure;
      if (Date.now() > end) throw new Error(`VNC: no answer in ${ms} ms`);
      await new Promise((r) => { wake = r; setTimeout(r, 200); });
    }
    const out = buf.subarray(0, n); buf = buf.subarray(n); return out;
  };
  await need(12);
  sock.write('RFB 003.008\n');
  const types = await need((await need(1))[0]);
  if (types.includes(2)) {
    sock.write(Buffer.from([2]));
    sock.write(answer(decodeURIComponent(u.password), await need(16)));
  } else if (types.includes(1)) sock.write(Buffer.from([1]));
  else throw new Error(`VNC: unknown security types ${[...types].join(',')}`);
  if ((await need(4)).readUInt32BE(0) !== 0) throw new Error('VNC: the password was refused');
  sock.write(Buffer.from([1])); // shared
  const init = await need(24);
  let width = init.readUInt16BE(0), height = init.readUInt16BE(2);
  await need(init.readUInt32BE(20));
  // 32-bit true colour with red, green, blue in bytes 0, 1, 2 (little endian), raw pixels only
  const fmt = Buffer.alloc(20); fmt[0] = 0; fmt[4] = 32; fmt[5] = 24; fmt[6] = 0; fmt[7] = 1; fmt.writeUInt16BE(255, 8); fmt.writeUInt16BE(255, 10); fmt.writeUInt16BE(255, 12); fmt[14] = 0; fmt[15] = 8; fmt[16] = 16;
  sock.write(fmt);
  // the VM's VNC server (Virtualization.framework) stops the whole VM if a client doesn't take its resize messages
  const encodings = [0, -223, -308, -224];
  const enc = Buffer.alloc(4 + encodings.length * 4); enc[0] = 2; enc.writeUInt16BE(encodings.length, 2);
  encodings.forEach((e, i) => enc.writeInt32BE(e, 4 + i * 4));
  sock.write(enc);
  let frame = Buffer.alloc(width * height * 4, 0);
  const update = async () => {
    const req = Buffer.alloc(10); req[0] = 3; req[1] = 0; req.writeUInt16BE(width, 6); req.writeUInt16BE(height, 8); sock.write(req);
    for (;;) {
      const type = (await need(1))[0];
      if (type === 2) continue; // bell
      if (type === 1) { const h = await need(5); await need(h.readUInt16BE(3) * 6); continue; } // colour map
      if (type === 3) { const h = await need(7); await need(h.readUInt32BE(3)); continue; } // clipboard
      if (type !== 0) throw new Error(`VNC: unexpected message ${type}`);
      const count = (await need(3)).readUInt16BE(1);
      for (let i = 0; i < count; i++) {
        const r = await need(12);
        const x = r.readUInt16BE(0), y = r.readUInt16BE(2), w = r.readUInt16BE(4), h = r.readUInt16BE(6), e = r.readInt32BE(8);
        if (e === -224) break; // last rectangle
        if (e === -223 || e === -308) { // the screen's new size
          if (e === -308) { const n = (await need(4))[0]; await need(n * 16); }
          if (w && h && (w !== width || h !== height)) { width = w; height = h; frame = Buffer.alloc(w * h * 4, 0); }
          continue;
        }
        if (e !== 0) throw new Error(`VNC: unexpected encoding ${e}`);
        const px = await need(w * h * 4, 120000);
        for (let row = 0; row < h; row++) px.copy(frame, ((y + row) * width + x) * 4, row * w * 4, (row + 1) * w * 4);
      }
      return;
    }
  };
  const pointer = (x, y, mask) => { const m = Buffer.alloc(6); m[0] = 5; m[1] = mask; m.writeUInt16BE(x, 2); m.writeUInt16BE(y, 4); sock.write(m); };
  const key = (code, down) => { const m = Buffer.alloc(8); m[0] = 4; m[1] = down ? 1 : 0; m.writeUInt32BE(code, 4); sock.write(m); };
  const click = async (x, y) => { pointer(x, y, 0); await sleep(150); pointer(x, y, 1); await sleep(90); pointer(x, y, 0); await sleep(150); };
  return {
    get width() { return width; }, get height() { return height; },
    screenshot: async (file) => {
      await update();
      for (let i = 3; i < frame.length; i += 4) frame[i] = 255;
      fs.writeFileSync(file, png(width, height, frame));
    },
    click,
    doubleClick: async (x, y) => { pointer(x, y, 0); await sleep(150); pointer(x, y, 1); await sleep(60); pointer(x, y, 0); await sleep(60); pointer(x, y, 1); await sleep(60); pointer(x, y, 0); await sleep(150); },
    type: async (text) => { for (const ch of text) { const c = ch === '\n' ? 0xff0d : ch.codePointAt(0); key(c, true); await sleep(30); key(c, false); await sleep(30); } },
    close: () => sock.destroy(),
  };
}
