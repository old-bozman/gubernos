// "Now" for the timestamps an edit writes (completed, reflection saved, created, log lines). Normally the clock; when the
// iPhone's offline queue reaches the Mac later, the server runs that request at the time it was made on the phone
// (header X-Gubernos-At, gubernos-ios Gubernos/Outbox.swift), so a task done last night isn't stamped as done this morning.
// The server plugs in a per-request lookup (AsyncLocalStorage); the offline page in the browser has none.
export const clock = { at: () => null };

export function now() {
  const at = clock.at();
  return at ? new Date(at) : new Date();
}

// The phone's time is trusted only if it is in the past and recent: a queued edit is replayed within days.
export function validAt(value, max = 30 * 864e5) {
  const t = Date.parse(String(value || ''));
  if (!Number.isFinite(t)) return null;
  const age = Date.now() - t;
  return age >= -60e3 && age <= max ? new Date(Math.min(t, Date.now())).toISOString() : null;
}
