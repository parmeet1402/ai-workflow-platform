-- Chat persistence (CP6): conversations + messages with org-scoped RLS.
-- Application routes still enforce membership; RLS is defense-in-depth.

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE CASCADE,
  CONSTRAINT conversations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations (id) ON DELETE CASCADE,
  CONSTRAINT messages_role_check CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text])),
  CONSTRAINT messages_prompt_tokens_nonneg CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  CONSTRAINT messages_completion_tokens_nonneg CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  CONSTRAINT messages_total_tokens_nonneg CHECK (total_tokens IS NULL OR total_tokens >= 0)
);

CREATE INDEX IF NOT EXISTS idx_conversations_org_updated
  ON public.conversations (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
  ON public.conversations (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at ASC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Conversations: org members can read; inserts/updates/deletes for own rows in org.
CREATE POLICY "users can view org conversations"
  ON public.conversations
  FOR SELECT
  USING (
    organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "users can insert conversations in their org"
  ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "users can update own org conversations"
  ON public.conversations
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "users can delete own org conversations"
  ON public.conversations
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  );

-- Messages: access via parent conversation org membership.
CREATE POLICY "users can view org conversation messages"
  ON public.messages
  FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversations.id
      FROM public.conversations
      WHERE conversations.organization_id IN (
        SELECT memberships.organization_id
        FROM public.memberships
        WHERE memberships.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "users can insert messages in own org conversations"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    conversation_id IN (
      SELECT conversations.id
      FROM public.conversations
      WHERE conversations.user_id = auth.uid()
        AND conversations.organization_id IN (
          SELECT memberships.organization_id
          FROM public.memberships
          WHERE memberships.user_id = auth.uid()
        )
    )
  );

CREATE POLICY "users can delete messages in own org conversations"
  ON public.messages
  FOR DELETE
  TO authenticated
  USING (
    conversation_id IN (
      SELECT conversations.id
      FROM public.conversations
      WHERE conversations.user_id = auth.uid()
        AND conversations.organization_id IN (
          SELECT memberships.organization_id
          FROM public.memberships
          WHERE memberships.user_id = auth.uid()
        )
    )
  );

GRANT ALL ON TABLE public.conversations TO anon;
GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;
