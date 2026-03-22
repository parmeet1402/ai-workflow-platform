import type { AuthError } from "@supabase/supabase-js";

/** Maps Supabase auth errors to short, user-facing messages for toasts. */
export function getAuthErrorMessage(error: AuthError): string {
  const code = error.code ?? "";
  const msg = error.message;

  if (
    code === "invalid_credentials" ||
    /invalid login credentials|invalid email or password/i.test(msg)
  ) {
    return "Invalid email or password.";
  }

  if (
    code === "user_already_exists" ||
    /already registered|user already exists|already been registered/i.test(msg)
  ) {
    return "An account with this email already exists.";
  }

  if (
    code === "email_not_confirmed" ||
    /email not confirmed|confirm your email/i.test(msg)
  ) {
    return "Please confirm your email before signing in.";
  }

  if (
    /failed to fetch|network|load failed|fetch/i.test(msg) ||
    error.name === "AuthRetryableFetchError"
  ) {
    return "Network error. Check your connection and try again.";
  }

  return msg;
}
