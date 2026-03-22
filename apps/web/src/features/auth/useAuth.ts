"use client";

import { useContext } from "react";
import { AuthContext } from "./auth-context";

/**
 * Global auth state: Supabase user plus organization membership (id, name, role).
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
