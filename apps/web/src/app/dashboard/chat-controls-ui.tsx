"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronDown,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { canAdjustSystemPrompt } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { CHAT_MODELS, findChatModel, type ChatModelId } from "@/lib/chat/models";
import { useAuth } from "@/features/auth/useAuth";
import { useChatControls } from "./chat-controls-context";

export function ModelSelect({ disabled }: { disabled?: boolean }) {
  const { model, setModel } = useChatControls();
  const selected = findChatModel(model);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 max-w-[12rem] gap-1 px-2.5 text-xs font-medium text-foreground"
              disabled={disabled}
              title={`${selected.label} (${selected.id})`}
            >
              <span className="truncate">
                {selected.label} · {selected.dropdownHint}
              </span>
              <ChevronDown className="size-3.5 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {selected.dropdownHint} — {selected.label}
          </p>
          <p className="text-muted-foreground">{selected.id}</p>
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuRadioGroup
          value={model}
          onValueChange={(value) => setModel(value as ChatModelId)}
        >
          {CHAT_MODELS.map((item) => (
            <DropdownMenuRadioItem
              key={item.id}
              value={item.id}
              className="items-start py-2"
              title={item.id}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">
                  {item.dropdownHint}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {item.label}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{item.hint}</span>
                <span className="font-mono text-[10px] text-muted-foreground/80">
                  {item.id}
                </span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SystemPromptControl({ disabled }: { disabled?: boolean }) {
  const { role } = useAuth();
  const {
    systemPrompt,
    isCustomSystemPrompt,
    systemPromptSaving,
    saveSystemPrompt,
    resetSystemPrompt,
    openSettings,
  } = useChatControls();

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(systemPrompt);

  React.useEffect(() => {
    if (open) {
      setDraft(systemPrompt);
    }
  }, [open, systemPrompt]);

  if (!canAdjustSystemPrompt(role)) {
    return null;
  }

  const busy = disabled || systemPromptSaving;

  const onSave = async () => {
    const next = draft.trim();
    if (!next) {
      toast.error("System prompt cannot be empty");
      return;
    }
    try {
      await saveSystemPrompt(next);
      setOpen(false);
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
      setOpen(false);
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
          disabled={busy}
        >
          {isCustomSystemPrompt ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-primary"
              aria-hidden
            />
          ) : null}
          <span>
            Prompt · {isCustomSystemPrompt ? "Custom" : "Default"}
          </span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 gap-3">
        <PopoverHeader>
          <PopoverTitle>System prompt</PopoverTitle>
          <PopoverDescription>
            Organization-wide. Applies to every member&apos;s chats.
          </PopoverDescription>
        </PopoverHeader>

        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-36 font-mono text-xs"
          disabled={systemPromptSaving}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-xs"
            disabled={systemPromptSaving}
            onClick={() => {
              setOpen(false);
              openSettings("system");
            }}
          >
            Open in Settings
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={systemPromptSaving}
              onClick={() => void onReset()}
            >
              Reset to default
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={systemPromptSaving}
              onClick={() => void onSave()}
            >
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function JsonModeToggle({ disabled }: { disabled?: boolean }) {
  const { jsonMode, setJsonMode } = useChatControls();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={jsonMode ? "default" : "ghost"}
          size="sm"
          className={cn(
            "h-8 min-w-8 px-2.5 text-xs",
            jsonMode
              ? "font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
          disabled={disabled}
          aria-pressed={jsonMode}
          onClick={() => setJsonMode(!jsonMode)}
        >
          {jsonMode ? <Check className="size-3.5" /> : null}
          JSON
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>
          {jsonMode
            ? "JSON mode on — next reply will be structured"
            : "Turn on JSON mode for the next reply"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Insert rule: empty composer → replace; non-empty → append with a blank line.
 */
export function TemplatesControl({
  composerValue,
  onInsert,
  disabled,
}: {
  composerValue: string;
  onInsert: (next: string) => void;
  disabled?: boolean;
}) {
  const {
    templates,
    templatesLoading,
    templatesError,
    addTemplate,
    openSettings,
  } = useChatControls();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [naming, setNaming] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const hasDraft = Boolean(composerValue.trim());

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q),
    );
  }, [templates, query]);

  const insertTemplate = (body: string) => {
    const trimmedComposer = composerValue.trim();
    const next = trimmedComposer
      ? `${composerValue.replace(/\s+$/, "")}\n\n${body}`
      : body;
    onInsert(next);
    setOpen(false);
    toast.success("Template inserted");
  };

  const onSaveCurrent = async () => {
    const body = composerValue.trim();
    if (!body) {
      toast.error("Type a message before saving a template");
      return;
    }
    setSaving(true);
    try {
      await addTemplate({
        name: saveName.trim() || body.slice(0, 40),
        body,
      });
      setNaming(false);
      setSaveName("");
      setOpen(false);
      toast.success("Template saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save template",
      );
    } finally {
      setSaving(false);
    }
  };

  const onQuickSave = async () => {
    const body = composerValue.trim();
    if (!body) return;
    setSaving(true);
    try {
      await addTemplate({
        name: body.slice(0, 40),
        body,
      });
      toast.success("Template saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save template",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setNaming(false);
            setSaveName("");
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 text-muted-foreground"
                disabled={disabled}
                aria-label="Templates"
              >
                <Bookmark className="size-3.5" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Templates</p>
          </TooltipContent>
        </Tooltip>

        <PopoverContent align="start" className="w-80 gap-3">
          <PopoverHeader>
            <PopoverTitle>Templates</PopoverTitle>
            <PopoverDescription>
              Shared with your org. Click to insert into the composer.
            </PopoverDescription>
          </PopoverHeader>

          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…"
              className="h-8 pl-8 text-xs"
            />
          </div>

          {templatesError ? (
            <p className="px-1 text-xs text-destructive">{templatesError}</p>
          ) : null}

          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {templatesLoading ? (
              <li className="px-1 py-4 text-center text-xs text-muted-foreground">
                Loading templates…
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-1 py-4 text-center text-xs text-muted-foreground">
                No templates found.
              </li>
            ) : (
              filtered.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
                    onClick={() => insertTemplate(template.body)}
                  >
                    <div className="truncate text-sm font-medium">
                      {template.name}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {template.body}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>

          {naming ? (
            <div className="space-y-2 border-t pt-3">
              <Label htmlFor="save-template-name" className="text-xs">
                Template name
              </Label>
              <Input
                id="save-template-name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Name this template"
                className="h-8 text-xs"
                disabled={saving}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => setNaming(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void onSaveCurrent()}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 border-t pt-3">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Insert rule: empty composer replaces; otherwise appends below
                your draft.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0 text-xs"
                  onClick={() => {
                    setOpen(false);
                    openSettings("templates");
                  }}
                >
                  Manage in Settings
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setNaming(true)}
                  disabled={!hasDraft || saving}
                >
                  Save current
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {hasDraft ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 text-muted-foreground"
              disabled={disabled || saving}
              aria-label="Save current message as template"
              onClick={() => void onQuickSave()}
            >
              <BookmarkPlus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Save draft as template</p>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function JsonModeBadge() {
  return (
    <Badge
      variant="outline"
      className="h-5 border-primary/25 bg-primary/5 px-1.5 text-[10px] font-medium text-primary"
    >
      JSON
    </Badge>
  );
}

export function TypingIndicator() {
  return (
    <div
      className="flex items-center gap-1 py-1"
      aria-label="Assistant is typing"
    >
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70" />
    </div>
  );
}
