# User authentication

The user is able to **register**, **sign in**, and **sign out** using Supabase Auth, Next.js pages, and the `/auth/callback` route for email (and similar) exchanges. The session is stored in **cookies** that the browser Supabase client and the server client (`@supabase/ssr`) share, so API routes and Server Components see the same identity as the client.

Diagrams use [Mermaid](https://mermaid.js.org/).

---

## Implementation map

| Topic | Path |
|--------|------|
| Sign up | `apps/web/src/app/sign-up/page.tsx` |
| Log in | `apps/web/src/app/login/page.tsx` |
| Callback | `apps/web/src/app/auth/callback/route.ts` |
| Log out | `apps/web/src/components/logout-button.tsx` |
| Browser client | `apps/web/src/lib/supabase/client.ts` |
| Server client | `apps/web/src/lib/supabase/server.ts` |
| Auth error copy | `apps/web/src/lib/auth/supabase-errors.ts` |
| Auth context | `apps/web/src/app/layout.tsx`, `apps/web/src/features/auth/auth-context.tsx` |

---

## Environment variables

| Variable | Role |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (browser and server) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key for both clients |

---

## Session over cookies

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "fontFamily": "ui-sans-serif, system-ui, sans-serif",
    "fontSize": "14px",
    "lineColor": "#64748b",
    "primaryColor": "#e0e7ff",
    "primaryTextColor": "#312e81",
    "primaryBorderColor": "#6366f1"
  },
  "flowchart": { "curve": "basis", "padding": 16 }
}}%%
flowchart TB
  subgraph Client["Browser"]
    direction TB
    P1["Pages: /login, /sign-up, /dashboard"]
    BC["Supabase browser client"]
  end

  subgraph Server["Next.js server"]
    direction TB
    P2["Server Components and API routes"]
    SC["Supabase server client"]
  end

  subgraph Remote["Supabase Auth"]
    AUTH["Auth service"]
  end

  P1 <--> BC
  P2 <--> SC
  BC <-->|HTTPS| AUTH
  SC <-->|HTTPS| AUTH
  BC <-.->|shared session cookies| SC

  style Client fill:#eef2ff,stroke:#6366f1,stroke-width:2px
  style Server fill:#ecfdf5,stroke:#10b981,stroke-width:2px
  style Remote fill:#fff7ed,stroke:#ea580c,stroke-width:2px
```

The dotted edge indicates that both clients read and write the **same cookie jar**, so one logical session applies across client and server.

---

## Registration

**Route:** `/sign-up`

The user is able to create an account by submitting **name**, **email**, and **password**. The form is validated with **Zod** on the client. The app calls `supabase.auth.signUp` with `emailRedirectTo` set to `{origin}/auth/callback` and `data: { full_name: name }`. Whether **email confirmation** is required before sign-in is configured in the Supabase dashboard, not in this repository.

After the user completes verification (when enabled), `GET /auth/callback` exchanges the code for a session and redirects to `/dashboard`. The root layout loads the current user on the server and passes membership into `AuthProvider`, which enables organization-scoped features (for example documents).

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "actorBkg": "#e0e7ff",
    "actorBorder": "#6366f1",
    "actorTextColor": "#312e81",
    "signalColor": "#475569",
    "sequenceNumberColor": "#6366f1"
  }
}}%%
sequenceDiagram
  autonumber
  actor User
  participant Page as Sign-up page
  participant Auth as Supabase Auth
  participant Email as Email inbox
  participant Route as /auth/callback

  User->>Page: Submit form
  Page->>Page: Zod validation
  Page->>Auth: signUp + emailRedirectTo

  alt Error
    Auth-->>Page: AuthError
    Page-->>User: Error toast
  else Success
    Auth-->>Page: OK
    Page-->>User: Success toast
    Auth->>Email: Verification email when enabled
    User->>Email: Open link
    Email->>Route: GET with code
    Route->>Auth: exchangeCodeForSession
    Route-->>User: Redirect /dashboard
  end
```

---

## Login

**Route:** `/login`

The user is able to sign in with **email** and **password** after **Zod** validation. The app calls `supabase.auth.signInWithPassword`. On success, a toast is shown and the browser navigates to **`/dashboard`** with a full page load so cookies are consistent for the next server render. The dashboard page calls `getUser()` and redirects to `/login` when there is no user. Helpers for middleware-style redirects live in `apps/web/src/proxy.ts` but are **not** imported from a root `middleware.ts` in the current tree.

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "actorBkg": "#e0e7ff",
    "actorBorder": "#6366f1",
    "actorTextColor": "#312e81",
    "signalColor": "#475569",
    "sequenceNumberColor": "#6366f1"
  }
}}%%
sequenceDiagram
  autonumber
  actor User
  participant Login as Login page
  participant Auth as Supabase Auth

  User->>Login: Submit email + password
  Login->>Login: Zod validate
  Login->>Auth: signInWithPassword
  alt Failed
    Auth-->>Login: error
    Login-->>User: Error toast
  else Succeeded
    Auth-->>Login: Session in cookies
    Login-->>User: Success toast + /dashboard
  end
```

---

## Logout

The user is able to sign out from the dashboard via **`LogoutButton`**. The component calls `supabase.auth.signOut()` and then navigates to **`/login`**.

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "actorBkg": "#e0e7ff",
    "actorBorder": "#6366f1",
    "actorTextColor": "#312e81",
    "signalColor": "#475569",
    "sequenceNumberColor": "#6366f1"
  }
}}%%
sequenceDiagram
  autonumber
  actor User
  participant Btn as LogoutButton
  participant Auth as Supabase Auth

  User->>Btn: Click
  Btn->>Auth: signOut()
  Auth-->>Btn: Done
  Btn-->>User: Navigate to /login
```

---

## Quick reference

| Action | Where it happens |
|--------|------------------|
| Register | `/sign-up` → `signUp` |
| Confirm email | `GET /auth/callback` → `exchangeCodeForSession` → `/dashboard` |
| Log in | `/login` → `signInWithPassword` → `/dashboard` |
| Log out | `signOut` → `/login` |

---

## Supabase checklist

- **Site URL** and **Redirect URLs** include the app origin and `/auth/callback`.
- **Email confirmation** matches the intended UX (required vs optional).

---

## See also

- [Document management](document-management.md) — organization-scoped PDFs using the same session.
