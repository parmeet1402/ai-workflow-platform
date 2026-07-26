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
    systemPrompt,
    systemPromptSaving,
    saveSystemPrompt,
    resetSystemPrompt,
  } = useChatControls();

  const [draft, setDraft] = React.useState(systemPrompt);

  React.useEffect(() => {
    setDraft(systemPrompt);
  }, [systemPrompt]);

  const onSave = async () => {
    const next = draft.trim() || getBuiltInSystemPrompt();
    try {
      await saveSystemPrompt(next);
      toast.success("Organization system prompt saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save system prompt",
      );
    }
  };

  const onReset = async () => {
    try {
      await resetSystemPrompt();
      setDraft(getBuiltInSystemPrompt());
      toast.success("Reset to built-in default");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to reset system prompt",
      );
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="settings-system-prompt">System prompt</Label>
        <p className="text-xs text-muted-foreground">
          Organization-wide. Applies to every member&apos;s chats.
        </p>
        <Textarea
          id="settings-system-prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-48 font-mono text-xs"
          disabled={systemPromptSaving}
        />
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={systemPromptSaving}
          onClick={() => void onReset()}
        >
          Reset to default
        </Button>
        <Button
          type="button"
          disabled={systemPromptSaving}
          onClick={() => void onSave()}
        >
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}

function TemplatesSettings() {
  const {
    templates,
    templatesLoading,
    templatesError,
    addTemplate,
    updateTemplate,
    deleteTemplate,
  } = useChatControls();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [nameDraft, setNameDraft] = React.useState("");
  const [bodyDraft, setBodyDraft] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

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

  const onSave = async () => {
    if (!bodyDraft.trim()) {
      toast.error("Template body is required");
      return;
    }
    setSaving(true);
    try {
      if (creating) {
        await addTemplate({ name: nameDraft, body: bodyDraft });
        toast.success("Template created");
      } else if (editingId) {
        await updateTemplate(editingId, { name: nameDraft, body: bodyDraft });
        toast.success("Template updated");
      }
      cancelEdit();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save template",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Shared with your organization. Insert from the composer Templates
          control.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={startCreate}
          disabled={templatesLoading || saving}
        >
          New template
        </Button>
      </div>

      {templatesError ? (
        <p className="text-xs text-destructive">{templatesError}</p>
      ) : null}

      {creating || editingId ? (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Template name"
              disabled={saving}
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
              disabled={saving}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelEdit}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void onSave()}
            >
              Save template
            </Button>
          </div>
        </div>
      ) : null}

      {templatesLoading ? (
        <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          Loading templates…
        </div>
      ) : templates.length === 0 && !creating ? (
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
                    disabled={saving}
                    onClick={() => startEdit(template.id)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${template.name}`}
                    disabled={saving}
                    onClick={() => {
                      void (async () => {
                        try {
                          await deleteTemplate(template.id);
                          toast.success("Template deleted");
                        } catch (error) {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Failed to delete template",
                          );
                        }
                      })();
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
                ? "Organization system prompt and prompt templates. Chat model and JSON mode stay in the chat column."
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
