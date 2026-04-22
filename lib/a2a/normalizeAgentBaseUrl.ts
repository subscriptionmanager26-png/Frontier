/**
 * Normalize user input into an A2A agent base URL (origin + optional path, no trailing slash).
 * Accepts full URLs or bare hostnames (https prepended).
 */
export function normalizeAgentBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/\s/.test(candidate)) return null;
    if (!candidate.includes('.')) return null;
    candidate = `https://${candidate}`;
  }

  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}
