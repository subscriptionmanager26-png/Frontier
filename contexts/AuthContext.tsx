import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

import { requestA2aUiRefresh } from '@/lib/a2aUiRefreshBus';
import { clearSessionLocalCaches } from '@/lib/clearSessionLocalCaches';
import { pushA2aDeviceStateToCloud, resetA2aCloudRestoreDedupe } from '@/lib/cloudA2aState';
import { isAgentUsernameAvailable, validateSignupEmail } from '@/lib/agentUsername';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { logUxFlow, shortUserId } from '@/lib/uxFlowLog';
import { ensureUserScopedDocumentRoot } from '@/lib/userScopedStorage';
import { ensurePrimaryUserAgent } from '@/lib/userAgents';

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string
  ) => Promise<{
    error: string | null;
    needsEmailConfirmation: boolean;
  }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function bootstrapUserAgentForSession(
  userId: string,
  label: string,
  authEvent?: string
): Promise<void> {
  /** Avoid re-seeding / slug churn on every access-token refresh. */
  if (authEvent === 'TOKEN_REFRESHED') return;
  await ensureUserScopedDocumentRoot(userId).catch(() => {});
  await ensurePrimaryUserAgent({ defaultName: label });
  // Keep central discoverability state in sync even when no Agents tab exists.
  try {
    const mod = await import('@/lib/discoverableAgentsCloudStore');
    await mod.pushDiscoverableAgentsToCloud();
    // eslint-disable-next-line no-console
    console.log('[DISCOVERY] bootstrap push success');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[DISCOVERY] bootstrap push failed', e instanceof Error ? e.message : String(e));
    // best effort
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  /** Last Supabase user id we applied local storage for (isolates multi-account on one device). */
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let mounted = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      lastUserIdRef.current = data.session?.user?.id ?? null;
      setSession(data.session ?? null);
      setLoading(false);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      void (async () => {
        const nextId = nextSession?.user?.id ?? null;
        const prevId = lastUserIdRef.current;

        if (event !== 'TOKEN_REFRESHED') {
          await logUxFlow('ux.flow.auth.supabase_event', {
            authEvent: event,
            userId: nextId ?? undefined,
            prevUserShort: shortUserId(prevId),
          });
        }

        if (nextId === null) {
          await clearSessionLocalCaches('auth_listener_signed_out');
          lastUserIdRef.current = null;
        } else if (prevId !== null && prevId !== nextId) {
          await clearSessionLocalCaches('auth_listener_account_switch');
          lastUserIdRef.current = nextId;
        } else {
          lastUserIdRef.current = nextId;
        }

        if (!mounted) return;
        setSession(nextSession);
        setLoading(false);
        if (nextId) {
          const label = nextSession!.user.email?.split('@')[0]?.trim() || 'My Agent';
          void bootstrapUserAgentForSession(nextId, label, event);
        }
        /** Inbox / Direct lists refetch without requiring the user to stay on Requests (account switches, single device). */
        if (nextId && event !== 'TOKEN_REFRESHED') {
          requestA2aUiRefresh();
        }
      })();
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      configured: hasSupabaseConfig,
      signIn: async (email: string, password: string) => {
        if (!supabase) return { error: 'Supabase is not configured.' };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (!error) {
          const { data: s } = await supabase.auth.getSession();
          const uid = s.session?.user?.id;
          const label = email.split('@')[0]?.trim() || 'My Agent';
          if (uid) await bootstrapUserAgentForSession(uid, label);
        }
        return { error: error?.message ?? null };
      },
      signUp: async (email: string, password: string) => {
        if (!supabase) return { error: 'Supabase is not configured.', needsEmailConfirmation: false };
        const v = validateSignupEmail(email);
        if (!v.ok) return { error: v.message, needsEmailConfirmation: false };
        const free = await isAgentUsernameAvailable(v.slug);
        if (!free) {
          return {
            error: 'This email’s public handle is already registered. Sign in or use a different email.',
            needsEmailConfirmation: false,
          };
        }

        const { data, error } = await supabase.auth.signUp({
          email: v.email,
          password,
          options: {
            emailRedirectTo: 'frontier://auth',
            data: { public_username: v.slug },
          },
        });
        const needsEmailConfirmation = !data.session;
        if (!error && data.session?.user?.id) {
          const label = v.email.split('@')[0]?.trim() || 'My Agent';
          await bootstrapUserAgentForSession(data.session.user.id, label);
        }
        return { error: error?.message ?? null, needsEmailConfirmation };
      },
      signOut: async () => {
        if (supabase) {
          const { data: sess } = await supabase.auth.getSession();
          const uid = sess.session?.user?.id ?? null;
          await logUxFlow('ux.flow.auth.sign_out_start', { userId: uid ?? undefined });
          await pushA2aDeviceStateToCloud().catch(() => {});
          resetA2aCloudRestoreDedupe();
          await clearSessionLocalCaches('sign_out_explicit');
          await supabase.auth.signOut();
        } else {
          await clearSessionLocalCaches('sign_out_no_supabase');
        }
      },
    }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
