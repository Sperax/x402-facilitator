/**
 * Resolve the client address from X-Forwarded-For.
 *
 * Each proxy appends the address it received the request from, so only the
 * right-most `trustedHops` entries were written by infrastructure we control.
 * Anything to the left is client-supplied and spoofable. With 0 trusted hops
 * (no proxy in front) the header is ignored entirely.
 */
export function clientAddress(forwardedFor: string | undefined, trustedHops: number): string {
  if (trustedHops <= 0 || !forwardedFor) return 'direct';
  const hops = forwardedFor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length < trustedHops) return 'direct';
  return hops[hops.length - trustedHops];
}
