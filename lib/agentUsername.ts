import { supabase } from '@/lib/supabase';

import { emailToPublicSlug } from '@/lib/publicIdentitySlug';
import { sanitizeAgentUsername } from '@/lib/userAgents';

export { sanitizeAgentUsername };

export function validateSignupEmail(raw: string): { ok: true; email: string; slug: string } | { ok: false; message: string } {
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: false, message: 'Enter your email.' };
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1 || email.includes(' ')) {
    return { ok: false, message: 'Enter a valid email address.' };
  }
  const slug = emailToPublicSlug(email);
  if (!slug) return { ok: false, message: 'Could not derive a public handle from this email.' };
  return { ok: true, email, slug };
}

/**
 * Returns whether the slug is free in `discoverable_user_agents` (RPC).
 * Requires migration `is_agent_username_available` on the Supabase project.
 */
export async function isAgentUsernameAvailable(slug: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('is_agent_username_available', {
    candidate: slug,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[USERNAME] availability check failed', error.message);
    return false;
  }
  return data === true;
}

/** Slug stored in auth metadata / discoverability — derived from email at signup. */
export async function isEmailIdentityAvailableForSignup(email: string): Promise<boolean> {
  const slug = emailToPublicSlug(email.trim().toLowerCase());
  if (!slug) return false;
  return isAgentUsernameAvailable(slug);
}
