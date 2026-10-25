import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { customFetch } from "@/lib/api-client/custom-fetch";
import { getSupabaseClient } from "@/lib/supabase";

export interface SiteAccessStatus {
  userId: string;
  email: string;
  displayName: string;
  status: "pending" | "approved" | "denied" | "blocked";
  requestedAt: string;
  denialReason: string | null;
  blockedUntil: string | null;
  blockedReason: string | null;
  isAdmin: boolean;
}

interface SiteAuthContextValue {
  session: Session | null;
  access: SiteAccessStatus | null;
  loading: boolean;
  refreshAccess: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SiteAuthContext = createContext<SiteAuthContextValue | null>(null);

export function SiteAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<SiteAccessStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAccess(currentSession: Session | null): Promise<void> {
    if (!currentSession) {
      setAccess(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await customFetch<SiteAccessStatus>("/api/site-access/status", {
        headers: { Authorization: `Bearer ${currentSession.access_token}` },
      });
      setAccess(result);
    } catch {
      setAccess(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => {};
    void getSupabaseClient().then(async (client) => {
      if (!active) return;
      if (!client) {
        setLoading(false);
        return;
      }
      const { data } = await client.auth.getSession();
      if (!active) return;
      setSession(data.session);
      void loadAccess(data.session);
      const { data: authListener } = client.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        void loadAccess(nextSession);
      });
      unsubscribe = () => authListener.subscription.unsubscribe();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function refreshAccess(): Promise<void> {
    await loadAccess(session);
  }

  async function signOut(): Promise<void> {
    const client = await getSupabaseClient();
    if (client) await client.auth.signOut();
    setSession(null);
    setAccess(null);
  }

  return (
    <SiteAuthContext.Provider value={{ session, access, loading, refreshAccess, signOut }}>
      {children}
    </SiteAuthContext.Provider>
  );
}

export function useSiteAuth(): SiteAuthContextValue {
  const context = useContext(SiteAuthContext);
  if (!context) throw new Error("useSiteAuth must be used inside SiteAuthProvider");
  return context;
}