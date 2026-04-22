/**
 * Public agent slug derived from the account email (full address). Output uses only
 * `[a-z0-9-]` so it is safe for URL path segments and for Postgres `lower(slug)` uniqueness.
 * Set once at signup and treated as immutable elsewhere.
 */

function encodeEmailPart(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '-') out += '-hyp-';
    else if (ch === '.') out += '-dot-';
    else if (ch === '+') out += '-plus-';
    else if (ch === '_') out += '-und-';
    else if (ch >= 'a' && ch <= 'z') out += ch;
    else if (ch >= '0' && ch <= '9') out += ch;
    else if (cp < 128) out += `-x${cp.toString(16).padStart(2, '0')}-`;
    else out += `-u${cp.toString(16)}-`;
  }
  return out;
}

/**
 * Deterministic, reversible-style encoding (lowercase email in → lowercase slug out).
 * Example: `alice@example.com` → `alice-at-example-dot-com`
 */
export function emailToPublicSlug(email: string): string {
  const n = email.trim().toLowerCase();
  const at = n.indexOf('@');
  if (at < 1 || at === n.length - 1) return '';
  const local = n.slice(0, at);
  const domain = n.slice(at + 1);
  if (!local || !domain) return '';
  return `${encodeEmailPart(local)}-at-${encodeEmailPart(domain)}`;
}
