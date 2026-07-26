"use client";

import * as React from "react";
import { toast } from "sonner";
import { Pencil, SettingsIcon, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { canAdjustSystemPrompt } from "@/lib/auth/roles";
import { getBuiltInSystemPrompt } from "@/lib/chat/chat-controls-storage";
import { useAuth } from "@/features/auth/useAuth";
import { useChatControls, type SettingsTab } from "./chat-controls-context";

function SystemPromptSettings() {
  const {
    defaultSystemPrompt,
    setDefaultSystemPrompt,
    resetDefaultSystemPrompt,
    setSystemPromptForChat,
  } = useChatControls();

  const [draft, setDraft] = React.useState(defaultSystemPrompt);
  const [applyToCurrentChat, setApplyToCurrentChat] = React.useState(false);

  React.useEffect(() => {
    setDraft(defaultSystemPrompt);
  }, [defaultSystemPrompt]);

  const onSave = () => {
    const next = draft.trim() || getBuiltInSystemPrompt();
    setDefaultSystemPrompt(next);
    if (applyToCurrentChat) {
      setSystemPromptForChat(next);
    }
    toast.success("Default system prompt saved");
  };

  const onReset = () => {
    resetDefaultSystemPrompt();
    setDraft(getBuiltInSystemPrompt());
    toast.success("Reset to built-in default");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="settings-system-prompt">System prompt</Label>
        <p className="text-xs text-muted-foreground">
          Default for new chats. Individual chats can override this from the
          chat header.
        </p>
        <Textarea
          id="settings-system-prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-48 font-mono text-xs"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={applyToCurrentChat}
          onChange={(e) => setApplyToCurrentChat(e.target.checked)}
        />
        Also apply to the current chat
      </label>

      <DialogFooter className="gap-2 sm:justify-between">
        <Button type="button" variant="outline" onClick={onReset}>
          Reset to default
        </Button>
        <Button type="button" onClick={onSave}>
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}

function TemplatesSettings() {
  const { templates, addTemplate, updateTemplate, deleteTemplate } =
    useChatControls();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [nameDraft, setNameDraft] = React.useState("");
  const [bodyDraft, setBodyDraft] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setNameDraft("");
    setBodyDraft("");
  };

  const startEdit = (id: string) => {
    const t = templates.find((item) => item.id === id);
    if (!t) return;
    setCreating(false);
    setEditingId(id);
    setNameDraft(t.name);
    setBodyDraft(t.body);
  };

  const cancelEdit = () => {
    setCreating(false);
    setEditingId(null);
    setNameDraft("");
    setBodyDraft("");
  };

  const onSave = () => {
    if (!bodyDraft.trim()) {
      toast.error("Template body is required");
      return;
    }
    if (creating) {
      addTemplate({ name: nameDraft, body: bodyDraft });
      toast.success("Template created");
    } else if (editingId) {
      updateTemplate(editingId, { name: nameDraft, body: bodyDraft });
      toast.success("Template updated");
    }
    cancelEdit();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Manage saved prompts. Insert them from the composer Templates control.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={startCreate}>
          New template
        </Button>
      </div>

      {creating || editingId ? (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Template name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-body">Body</Label>
            <Textarea
              id="template-body"
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              className="min-h-28"
              placeholder="Prompt text…"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onSave}>
              Save template
            </Button>
          </div>
        </div>
      ) : null}

      {templates.length === 0 && !creating ? (
        <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No templates yet.
        </div>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {templates.map((template) => (
            <li
              key={template.id}
              className="rounded-lg border px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {template.name}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {template.body}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Edit ${template.name}`}
                    onClick={() => startEdit(template.id)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${template.name}`}
                    onClick={() => {
                      deleteTemplate(template.id);
                      toast.success("Template deleted");
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DashboardSettings() {
  const { role } = useAuth();
  const canEditSystemPrompt = canAdjustSystemPrompt(role);
  const {
    settingsOpen,
    settingsTab,
    setSettingsOpen,
    setSettingsTab,
    openSettings,
  } = useChatControls();

  const effectiveTab: SettingsTab =
    !canEditSystemPrompt && settingsTab === "system"
      ? "templates"
      : settingsTab;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            onClick={() =>
              openSettings(canEditSystemPrompt ? "system" : "templates")
            }
          >
            <SettingsIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Settings</p>
        </TooltipContent>
      </Tooltip>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              {canEditSystemPrompt
                ? "System prompt defaults and prompt templates. Chat model and JSON mode stay in the chat column."
                : "Prompt templates. Chat model and JSON mode stay in the chat column."}
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={effectiveTab}
            onValueChange={(value) => setSettingsTab(value as SettingsTab)}
          >
            <TabsList className="w-full">
              {canEditSystemPrompt ? (
                <TabsTrigger value="system">System</TabsTrigger>
              ) : null}
              <TabsTrigger value="templates">Templates</TabsTrigger>
            </TabsList>
            {canEditSystemPrompt ? (
              <TabsContent value="system" className="mt-3">
                <SystemPromptSettings />
              </TabsContent>
            ) : null}
            <TabsContent value="templates" className="mt-3">
              <TemplatesSettings />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
