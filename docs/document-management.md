# Document management

How **PDF documents** are **listed**, **uploaded**, and **opened** in this app: dashboard UI, Next.js API routes, Supabase Postgres, and Supabase Storage.

Diagrams use [Mermaid](https://mermaid.js.org/). **Legend:** purple = entry, amber = decision, slate = step, indigo = API / Supabase call, green = success, red = error; panels show system boundaries.

---

## Source files

| Topic | Path |
|--------|------|
| List + upload UI | `apps/web/src/app/dashboard/dashboard-documents.tsx` |
| React Query setup | `apps/web/src/components/react-query-provider.tsx` |
| List API | `apps/web/src/app/api/documents/route.ts` |
| Upload API | `apps/web/src/app/api/documents/upload/route.ts` |
| Open / signed URL | `apps/web/src/app/api/documents/[documentId]/open/route.ts` |
| Service role (signing) | `apps/web/src/lib/supabase/service-role.ts` |
| Server Supabase | `apps/web/src/lib/supabase/server.ts` |

---

## Environment variables

| Variable | Role |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | User-scoped server + client access |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Optional; used to create **signed URLs** for Storage when the user JWT cannot sign (see [Open a document](#open-a-document-view)). |

---

## Big picture

Every document API route:

1. Identifies the user from the **session cookie**.
2. Loads **`memberships`** to get **`organization_id`**.
3. Only reads or writes data for that organization.

```mermaid
%%{init: {
  "theme": "base",
  "flowchart": { "curve": "basis", "padding": 18 },
  "themeVariables": {
    "fontFamily": "ui-sans-serif, system-ui, sans-serif",
    "lineColor": "#64748b"
  }
}}%%
flowchart LR
  subgraph UI[" 📋 Dashboard "]
    D[Document panel]
  end

  subgraph API[" 🔌 Next.js API "]
    L[GET /api/documents]
    U[POST …/upload]
    O[GET …/open]
  end

  subgraph SB[" 🗄 Supabase "]
    DB[("Postgres")]
    ST[["Storage: documents"]]
  end

  D --> L
  D --> U
  D --> O
  L --> DB
  U --> ST
  U --> DB
  O --> DB
  O --> ST

  style UI fill:#eef2ff,stroke:#6366f1,stroke-width:2px
  style API fill:#ecfdf5,stroke:#10b981,stroke-width:2px
  style SB fill:#fff7ed,stroke:#ea580c,stroke-width:2px
```

---

## Data model (conceptual)

Users come from **Supabase Auth**. This diagram shows app tables and how they relate. Exact keys and RLS live in your Supabase project.

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "fontFamily": "ui-sans-serif, system-ui, sans-serif",
    "primaryColor": "#e0e7ff",
    "primaryTextColor": "#312e81",
    "primaryBorderColor": "#6366f1"
  }
}}%%
erDiagram
  ORGANIZATION ||--o{ MEMBERSHIP : contains
  USER ||--o{ MEMBERSHIP : has
  ORGANIZATION ||--o{ DOCUMENT : owns
  USER ||--o{ DOCUMENT : uploaded_by

  MEMBERSHIP {
    string user_id
    string organization_id
    string role
  }

  DOCUMENT {
    uuid id
    string organization_id
    string user_id
    string name
    string storage_path
    string created_at
  }

  ORGANIZATION {
    string id
    string name
  }

  USER {
    uuid id
  }
```

Rows in **USER** correspond to Supabase **`auth.users`** (not an app-owned table in this diagram).

**Storage path pattern:** `{organization_id}/{document_uuid}.pdf`

---

## List documents

**UI:** TanStack Query `useQuery` with key `["documents"]`.

**Request:** `GET /api/documents` with `credentials: "include"`.

**Server:** `getUser()` → load **one** `memberships` row for that user → `select` from **`documents`** where `organization_id` matches, ordered by `created_at` descending.

### Decision flow

```mermaid
%%{init: { "theme": "base", "flowchart": { "curve": "basis", "padding": 14 }, "themeVariables": { "fontFamily": "ui-sans-serif, system-ui, sans-serif" }}}%%
flowchart TD
  classDef startEnd fill:#6366f1,stroke:#4338ca,color:#fff,stroke-width:2px
  classDef decision fill:#fcd34d,stroke:#d97706,color:#422006,stroke-width:2px
  classDef process fill:#f1f5f9,stroke:#64748b,color:#0f172a
  classDef success fill:#34d399,stroke:#059669,color:#064e3b,stroke-width:2px
  classDef error fill:#f87171,stroke:#b91c1c,color:#fff,stroke-width:2px
  classDef api fill:#c7d2fe,stroke:#4f46e5,color:#1e1b4b

  START([Load document list]):::startEnd --> REQ[GET /api/documents + cookies]:::api
  REQ --> AUTH{Logged in?}:::decision
  AUTH -->|no| E401[401 — error UI]:::error
  AUTH -->|yes| MEM{Membership row?}:::decision
  MEM -->|no| E400[400 Org not found]:::error
  MEM -->|yes| Q[SELECT documents for org]:::process
  Q --> OK[200 JSON array]:::success
  OK --> RENDER[Render list]:::success
```

### Sequence

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
  participant UI as DashboardDocuments
  participant API as GET /api/documents
  participant SB as Supabase server
  participant DB as Postgres

  UI->>API: fetch + credentials
  API->>SB: auth.getUser
  alt No user
    API-->>UI: 401
  else Has user
    SB->>DB: membership by user_id
    alt No membership
      API-->>UI: 400
    else Has org
      SB->>DB: list documents by organization_id
      API-->>UI: 200 documents
    end
  end
```

**Success body:** `{ documents: [{ id, name, storage_path, user_id, organization_id, created_at }, ...] }`

---

## Upload documents

**UI rules:** 1–10 files, **PDF only** (`application/pdf`), validated with Zod.

**Important:** The UI sends **one file per HTTP request**. Each selected file triggers a separate `POST /api/documents/upload`.

**Form field name:** `file` (multipart).

### What the user sees

```mermaid
%%{init: { "theme": "base", "flowchart": { "curve": "basis", "padding": 14 }, "themeVariables": { "fontFamily": "ui-sans-serif, system-ui, sans-serif" }}}%%
flowchart TD
  classDef startEnd fill:#6366f1,stroke:#4338ca,color:#fff,stroke-width:2px
  classDef decision fill:#fcd34d,stroke:#d97706,color:#422006,stroke-width:2px
  classDef process fill:#f1f5f9,stroke:#64748b,color:#0f172a
  classDef success fill:#34d399,stroke:#059669,color:#064e3b,stroke-width:2px
  classDef error fill:#f87171,stroke:#b91c1c,color:#fff,stroke-width:2px
  classDef api fill:#c7d2fe,stroke:#4f46e5,color:#1e1b4b

  A([Choose PDFs]):::startEnd --> B{1–10 files, PDF only?}:::decision
  B -->|no| A
  B -->|yes| C[Each file: POST /upload]:::api
  C --> D{All OK?}:::decision
  D -->|no| E[Toast error]:::error
  D -->|yes| F[Toast success]:::success
  F --> G[Invalidate query]:::process
  G --> H[Refetch GET /documents]:::success
```

### What the server does (one upload)

```mermaid
%%{init: { "theme": "base", "flowchart": { "curve": "basis", "padding": 12 }, "themeVariables": { "fontFamily": "ui-sans-serif, system-ui, sans-serif" }}}%%
flowchart TD
  classDef startEnd fill:#6366f1,stroke:#4338ca,color:#fff,stroke-width:2px
  classDef decision fill:#fcd34d,stroke:#d97706,color:#422006,stroke-width:2px
  classDef process fill:#f1f5f9,stroke:#64748b,color:#0f172a
  classDef storage fill:#fde68a,stroke:#ca8a04,color:#422006
  classDef success fill:#34d399,stroke:#059669,color:#064e3b,stroke-width:2px
  classDef error fill:#f87171,stroke:#b91c1c,color:#fff,stroke-width:2px

  P([POST /api/documents/upload]):::startEnd --> U[getUser]:::process
  U --> U2{Session OK?}:::decision
  U2 -->|no| R401[401]:::error
  U2 -->|yes| M[Read membership → org]:::process
  M --> M2{Org OK?}:::decision
  M2 -->|no| R400[400]:::error
  M2 -->|yes| F[Read multipart field file]:::process
  F --> T{PDF type?}:::decision
  T -->|no| R400b[400]:::error
  T -->|yes| ID[UUID + storage path]:::process
  ID --> UP[Storage upload]:::storage
  UP --> UP2{OK?}:::decision
  UP2 -->|no| R500[500]:::error
  UP2 -->|yes| INS[INSERT documents]:::process
  INS --> I2{OK?}:::decision
  I2 -->|no| R500b[500]:::error
  I2 -->|yes| R200[200 + row]:::success
```

### Sequence (single file)

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
  participant UI as DashboardDocuments
  participant API as POST …/upload
  participant SB as Supabase server
  participant ST as Storage
  participant DB as Postgres

  UI->>API: multipart file
  API->>SB: getUser
  SB->>DB: membership
  API->>SB: storage.upload
  SB->>ST: PUT object
  API->>SB: insert document
  SB->>DB: INSERT
  API-->>UI: 200 + document
```

**Success body:** `{ success: true, document: { ... } }`

### Remove button in the UI

The **X** control **only removes the row from React Query cache** and shows a toast. It does **not** call an API: **Storage and the database are unchanged** until you add a delete endpoint.

---

## Open a document (view)

**UI:** Link to `/api/documents/{id}/open` with `target="_blank"`.

**Server:**

1. Ensure user is logged in.
2. Ensure a **`documents`** row exists and its `organization_id` matches the user’s membership (otherwise **403** or **404**).
3. Call **`createSignedUrl`** on bucket `documents` for `storage_path` (TTL **3600** seconds in code).
4. Respond with **HTTP 302** to the signed URL. The browser loads the PDF from Supabase, not through your Node process.

### Access check + redirect

```mermaid
%%{init: { "theme": "base", "flowchart": { "curve": "basis", "padding": 14 }, "themeVariables": { "fontFamily": "ui-sans-serif, system-ui, sans-serif" }}}%%
flowchart TD
  classDef startEnd fill:#6366f1,stroke:#4338ca,color:#fff,stroke-width:2px
  classDef decision fill:#fcd34d,stroke:#d97706,color:#422006,stroke-width:2px
  classDef process fill:#f1f5f9,stroke:#64748b,color:#0f172a
  classDef sign fill:#c7d2fe,stroke:#4f46e5,color:#1e1b4b
  classDef success fill:#34d399,stroke:#059669,color:#064e3b,stroke-width:2px
  classDef error fill:#f87171,stroke:#b91c1c,color:#fff,stroke-width:2px

  A([Click document]):::startEnd --> B[New tab GET …/open + cookies]:::process
  B --> L[getUser]:::process
  L --> L2{Signed in?}:::decision
  L2 -->|no| E401[401 JSON]:::error
  L2 -->|yes| O[Load document + org match]:::process
  O --> O2{Allowed?}:::decision
  O2 -->|no| E403[403 / 404]:::error
  O2 -->|yes| S[createSignedUrl]:::sign
  S --> S2{Signed URL OK?}:::decision
  S2 -->|no| E500[500 JSON]:::error
  S2 -->|yes| REDIR[302 → signed URL]:::success
  REDIR --> PDF[Browser loads PDF]:::success
```

### Sequence

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "actorBkg": "#e0e7ff",
    "actorBorder": "#6366f1",
    "actorTextColor": "#312e81",
    "signalColor": "#475569",
    "sequenceNumberColor": "#6366f1",
    "noteBkgColor": "#fef3c7",
    "noteTextColor": "#78350f"
  }
}}%%
sequenceDiagram
  autonumber
  actor User
  participant Tab as Browser tab
  participant API as GET …/open
  participant SB as Supabase server
  participant ST as Storage

  User->>Tab: Click document link
  Tab->>API: GET + session cookie
  API->>SB: getUser, document, membership
  alt Not allowed
    API-->>Tab: 401 / 403 / 404 JSON
  else Allowed
    API->>ST: createSignedUrl service or user JWT
    Note over API,ST: Service role if SUPABASE_SERVICE_ROLE_KEY set
    API-->>Tab: 302 Location
    Tab->>ST: GET PDF
  end
```

### Why `SUPABASE_SERVICE_ROLE_KEY` exists

Storage **RLS** can block `createSignedUrl` for the normal user JWT even when your app has already verified org access. The open route prefers a **service role** client when the env var is set, **after** application-level checks, so signing succeeds. **Never expose this key to the browser.**

---

## API quick reference

| Action | HTTP | Notes |
|--------|------|--------|
| List | `GET /api/documents` | Cookie session |
| Upload | `POST /api/documents/upload` | `multipart/form-data`, field **`file`**, one PDF per request |
| Open | `GET /api/documents/:documentId/open` | **302** to signed Storage URL |

---

## Supabase checklist (documents)

- **Tables:** `memberships`, `organizations`, `documents` (and policies that match how the API queries them).
- **Storage:** Bucket named **`documents`**.
- **Server secrets:** `SUPABASE_SERVICE_ROLE_KEY` only in server env (for example `apps/web` for Route Handlers).

---

## See also

- [User authentication](authentication.md) — how the session cookie is established (required for all document APIs).
