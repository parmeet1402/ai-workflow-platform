# User authentication

How **registration**, **login**, and **logout** work in this app: Supabase Auth, Next.js pages, and the email callback route.

Diagrams use [Mermaid](https://mermaid.js.org/). **Legend:** purple = start or entry, amber = decision, slate = processing step, green = success path, red = error path, indigo panels = system boundaries.

---

## Source files

| Topic | Path |
|--------|------|
| Sign up | `apps/web/src/app/sign-up/page.tsx` |
| Log in | `apps/web/src/app/login/page.tsx` |
| Email / OAuth callback | `apps/web/src/app/auth/callback/route.ts` |
| Log out | `apps/web/src/components/logout-button.tsx` |
| Browser Supabase client | `apps/web/src/lib/supabase/client.ts` |
| Server Supabase client (cookies) | `apps/web/src/lib/supabase/server.ts` |
| Friendly error messages | `apps/web/src/lib/auth/supabase-errors.ts` |
| Global auth state | `apps/web/src/app/layout.tsx`, `apps/web/src/features/auth/auth-context.tsx` |

---

## Environment variables

| Variable | Role |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (browser + server) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key for both clients |

---

## How the session is shared

Supabase stores the session in **cookies**. The **browser** client and the **server** client (`@supabase/ssr`) read and update the same cookies, so Route Handlers and Server Components see the same user as the client.

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
  subgraph Client[" 🖥 Browser "]
    direction TB
    P1["Pages: /login, /sign-up, /dashboard"]
    BC["Supabase browser client"]
  end

  subgraph Server[" ⚙ Next.js server "]
    direction TB
    P2["Server Components + API routes"]
    SC["Supabase server client"]
  end

  subgraph Remote[" ☁ Supabase Auth "]
    AUTH["Auth service"]
  end

  P1 <--> BC
  P2 <--> SC
  BC <-->|"HTTPS"| AUTH
  SC <-->|"HTTPS"| AUTH
  BC <-.->|"shared session cookies"| SC

  style Client fill:#eef2ff,stroke:#6366f1,stroke-width:2px
  style Server fill:#ecfdf5,stroke:#10b981,stroke-width:2px
  style Remote fill:#fff7ed,stroke:#ea580c,stroke-width:2px
```

The dotted line means: both clients rely on the **same cookie jar** so the session is one logical login.

---

## Registration (sign up)

**Route:** `/sign-up`

1. User enters **name**, **email**, **password**.
2. **Zod** validates on the client.
3. App calls `supabase.auth.signUp` with:
   - `emailRedirectTo: {origin}/auth/callback`
   - `data: { full_name: name }`

Whether the user **must confirm email** before signing in is set in the **Supabase dashboard** (Auth), not in this repo.

### Diagram A — What happens on the sign-up page

```mermaid
%%{init: { "theme": "base", "flowchart": { "curve": "basis", "padding": 14 }, "themeVariables": { "fontFamily": "ui-sans-serif, system-ui, sans-serif" }}}%%
flowchart TD
  classDef startEnd fill:#6366f1,stroke:#4338ca,color:#fff,stroke-width:2px
  classDef decision fill:#fcd34d,stroke:#d97706,color:#422006,stroke-width:2px
  classDef process fill:#f1f5f9,stroke:#64748b,color:#0f172a
  classDef success fill:#34d399,stroke:#059669,color:#064e3b,stroke-width:2px
  classDef error fill:#f87171,stroke:#b91c1c,color:#fff,stroke-width:2px
  classDef api fill:#c7d2fe,stroke:#4f46e5,color:#1e1b4b

  S([Start: open /sign-up]):::startEnd --> F[Fill name, email, password]:::process
  F --> V{Zod valid?}:::decision
  V -->|fix form| F
  V -->|valid| U["signUp(...)"]:::api
  U --> R{Supabase response}:::decision
  R -->|error| T[Toast: getAuthErrorMessage]:::error
  R -->|success| M[Toast: check email / success]:::success
```

### Diagram B — After sign-up: email confirmation (when enabled)

```mermaid
%%{init: { "theme": "base", "flowchart": { "curve": "basis", "padding": 14 }, "themeVariables": { "fontFamily": "ui-sans-serif, system-ui, sans-serif" }}}%%
flowchart TD
  classDef startEnd fill:#6366f1,stroke:#4338ca,color:#fff,stroke-width:2px
  classDef process fill:#f1f5f9,stroke:#64748b,color:#0f172a
  classDef server fill:#a5b4fc,stroke:#4338ca,color:#1e1b4b
  classDef success fill:#34d399,stroke:#059669,color:#064e3b,stroke-width:2px

  E([Email arrives]):::startEnd --> L[User clicks verify link]:::process
  L --> C["GET /auth/callback?code=…"]:::process
  C --> X["exchangeCodeForSession(code)"]:::server
  X --> D([Redirect /dashboard]):::success
```

### Sequence — Sign-up and callback (end to end)

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
    Auth->>Email: Verification email optional
    User->>Email: Open link
    Email->>Route: GET ?code=
    Route->>Auth: exchangeCodeForSession
    Route-->>User: Redirect /dashboard
  end
```

### Session and org after login

The root layout loads the current user on the server and passes membership into `AuthProvider`. That powers org-scoped features (for example documents), not the auth forms themselves.

---

## Login

**Route:** `/login`

1. **Zod** validates email and password.
2. `supabase.auth.signInWithPassword({ email, password })`.
3. On success: success toast, then **`window.location.href = "/dashboard"`** (full page load so server and client agree on cookies).

### Diagram — Login flow

```mermaid
%%{init: { "theme": "base", "flowchart": { "curve": "basis", "padding": 14 }, "themeVariables": { "fontFamily": "ui-sans-serif, system-ui, sans-serif" }}}%%
flowchart TD
  classDef startEnd fill:#6366f1,stroke:#4338ca,color:#fff,stroke-width:2px
  classDef decision fill:#fcd34d,stroke:#d97706,color:#422006,stroke-width:2px
  classDef process fill:#f1f5f9,stroke:#64748b,color:#0f172a
  classDef api fill:#c7d2fe,stroke:#4f46e5,color:#1e1b4b
  classDef success fill:#34d399,stroke:#059669,color:#064e3b,stroke-width:2px
  classDef error fill:#f87171,stroke:#b91c1c,color:#fff,stroke-width:2px
  classDef warn fill:#fb923c,stroke:#c2410c,color:#fff

  L([User on /login]):::startEnd --> V{Zod valid?}:::decision
  V -->|no| L
  V -->|yes| SI[signInWithPassword]:::api
  SI --> E{Result}:::decision
  E -->|error| TE[Toast: getAuthErrorMessage]:::error
  E -->|ok| RD[Full navigation → /dashboard]:::process
  RD --> DB[Dashboard: getUser on server]:::process
  DB --> G{User exists?}:::decision
  G -->|no| RL[redirect /login]:::warn
  G -->|yes| OK[Show dashboard]:::success
```

### Sequence — Login

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

### Middleware note

`apps/web/src/proxy.ts` contains logic suitable for **Next.js middleware** (for example redirecting logged-in users away from `/login`). **No `middleware.ts` imports it today.** The dashboard is protected by calling `getUser()` in the dashboard page and `redirect("/login")` if there is no user.

---

## Logout

**Component:** `LogoutButton` on the dashboard.

1. `supabase.auth.signOut()`
2. `window.location.href = "/login"`

```mermaid
%%{init: { "theme": "base", "flowchart": { "curve": "linear", "padding": 20 }, "themeVariables": { "fontFamily": "ui-sans-serif, system-ui, sans-serif" }}}%%
flowchart LR
  classDef startEnd fill:#6366f1,stroke:#4338ca,color:#fff,stroke-width:2px
  classDef process fill:#f1f5f9,stroke:#64748b,color:#0f172a
  classDef api fill:#c7d2fe,stroke:#4f46e5,color:#1e1b4b
  classDef success fill:#34d399,stroke:#059669,color:#064e3b,stroke-width:2px

  A([Click logout]):::startEnd --> B[signOut]:::api
  B --> C[Session cleared]:::process
  C --> D([Open /login]):::success
```

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
|--------|-------------------|
| Register | Client: `/sign-up` → `signUp` |
| Confirm email | Server: `GET /auth/callback` → `exchangeCodeForSession` → redirect `/dashboard` |
| Log in | Client: `/login` → `signInWithPassword` → `/dashboard` |
| Log out | Client: `signOut` → `/login` |

---

## Supabase checklist (auth)

- Set **Site URL** and **Redirect URLs** to include your app origin and `/auth/callback`.
- Match **email confirmation** settings to the UX you want (required vs optional).

---

## See also

- [Document management](document-management.md) — org-scoped PDF list, upload, and open (uses the same session).
