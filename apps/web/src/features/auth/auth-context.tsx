"use client";

import { createClient } from "@/lib/supabase/client";
import { getMembershipForUser } from "@/lib/supabase/membership";
import type { User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AuthContextValue = {
  user: User | null;
  organizationId: string | null;
  organizationName: string | null;
  role: string | null;
};

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);

type AuthProviderProps = {
  children: ReactNode;
  initialUser: User | null;
  initialOrganizationId: string | null;
  initialOrganizationName: string | null;
  initialRole: string | null;
};

export function AuthProvider({
  children,
  initialUser,
  initialOrganizationId,
  initialOrganizationName,
  initialRole,
}: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [organizationId, setOrganizationId] = useState<string | null>(
    initialOrganizationId
  );
  const [organizationName, setOrganizationName] = useState<string | null>(
    initialOrganizationName
  );
  const [role, setRole] = useState<string | null>(initialRole);

  const applyUserAndMembership = useCallback(async (nextUser: User | null) => {
    setUser(nextUser);
    if (!nextUser) {
      setOrganizationId(null);
      setOrganizationName(null);
      setRole(null);
      return;
    }
    const supabase = createClient();
    const m = await getMembershipForUser(supabase, nextUser.id);
    setOrganizationId(m?.organization_id ?? null);
    setOrganizationName(m?.organizationName ?? null);
    setRole(m?.role ?? null);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applyUserAndMembership(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [applyUserAndMembership]);

  useEffect(() => {
    setUser(initialUser);
    setOrganizationId(initialOrganizationId);
    setOrganizationName(initialOrganizationName);
    setRole(initialRole);
  }, [
    initialUser,
    initialOrganizationId,
    initialOrganizationName,
    initialRole,
  ]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, organizationId, organizationName, role }),
    [user, organizationId, organizationName, role]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}
