"use client";

import { useAuth } from "@/features/auth/useAuth";

/** Client-side view of org context (mirrors server-loaded membership after hydration). */
export function DashboardOrg() {
  const { organizationId, organizationName, role } = useAuth();

  if (!organizationId && !role) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No organization membership found yet.
      </p>
    );
  }

  return (
    <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {organizationName ?? (
          <>
            Organization{" "}
            {organizationId ? (
              <code className="rounded bg-zinc-100 px-1 text-sm font-normal dark:bg-zinc-800">
                {organizationId}
              </code>
            ) : null}
          </>
        )}
      </p>
      {role ? (
        <p>
          Role:{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{role}</code>
        </p>
      ) : null}
    </div>
  );
}
