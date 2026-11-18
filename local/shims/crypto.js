// node:crypto for the iOS offline mode: only createHash, for cache keys (lib/planner.js), not for security. A 32-bit FNV-1a
// run four times with different seeds, as hex; the same text gives the same key, which is all a cache needs.
function createHash() {
  let text = '';
  const h = {
    update: (s) => { text += String(s); return h; },
    digest: () => [0x811c9dc5, 0x01000193, 0x2545f491, 0x9e3779b9].map((seed) => {
      let x = seed >>> 0;
      for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
      return x.toString(16).padStart(8, '0');
    }).join('') + '00000000',
  };
  return h;
}
const randomBytes = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return { toString: () => [...b].map((x) => x.toString(16).padStart(2, '0')).join('') }; };
export { createHash, randomBytes };
export default { createHash, randomBytes };
