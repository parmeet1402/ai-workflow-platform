"use client";

import * as React from "react";
import { FileText, Loader2, XIcon } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DocumentListItem, ProcessingStatus } from "@/types/document";

function documentSubtitle(doc: DocumentListItem): string {
  if (doc.created_at) {
    try {
      return new Date(doc.created_at).toLocaleString();
    } catch {
      return doc.storage_path;
    }
  }
  return doc.storage_path;
}

function processingBadgeLabel(status: ProcessingStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "processing":
      return "Processing";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function ProcessingStatusBadge({ status }: { status: ProcessingStatus }) {
  const label = processingBadgeLabel(status);
  if (status === "processing") {
    return (
      <Badge variant="default" className="shrink-0 gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {label}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="shrink-0">
        {label}
      </Badge>
    );
  }
  if (status === "ready") {
    return (
      <Badge variant="secondary" className="shrink-0">
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0">
      {label}
    </Badge>
  );
}

function listNeedsPolling(docs: DocumentListItem[] | undefined): boolean {
  if (!docs?.length) return false;
  return docs.some(
    (d) =>
      d.processing_status === "pending" || d.processing_status === "processing",
  );
}

type UploadFormValues = { files: File[] };

const FileArraySchema = z
  .array(z.instanceof(File))
  .min(1, "Select at least one PDF file.")
  .max(10, "Select up to 10 files.")
  .refine(
    (files) => files.every((file) => file.type === "application/pdf"),
    "Only PDF files are allowed.",
  );

const UploadSchema = z.object({
  files: FileArraySchema,
});

type UploadDocumentFromApi = Pick<
  DocumentListItem,
  "id" | "name" | "storage_path" | "processing_status"
>;

export default function DashboardDocuments() {
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [selectedCount, setSelectedCount] = React.useState(0);

  const {
    data: documents = [],
    isPending: documentsLoading,
    isError: documentsError,
    error: documentsErrorObj,
  } = useQuery({
    queryKey: ["documents"],
    queryFn: async (): Promise<DocumentListItem[]> => {
      const res = await fetch("/api/documents", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await res.json()) as
        | { documents: DocumentListItem[] }
        | { error: string };

      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : "Failed to load documents",
        );
      }
      if (!("documents" in payload)) {
        throw new Error("Invalid response from server");
      }
      return payload.documents;
    },
    refetchInterval: (query) =>
      listNeedsPolling(query.state.data as DocumentListItem[] | undefined)
        ? 4000
        : false,
  });

  const {
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<UploadFormValues>({
    resolver: zodResolver(UploadSchema),
    defaultValues: { files: [] },
    mode: "onChange",
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const uploaded: UploadDocumentFromApi[] = [];

      for (const file of files) {
        const formData = new FormData();
        // The API expects a `multipart/form-data` field named `file`.
        formData.append("file", file);

        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        type ApiResponse =
          | { success: true; document: UploadDocumentFromApi }
          | { error: string };
        const data = (await res.json()) as ApiResponse;

        if (!res.ok) {
          if ("error" in data) throw new Error(data.error);
          throw new Error(`Upload failed for ${file.name}`);
        }

        if (!("success" in data) || !data.success) {
          if ("error" in data) throw new Error(data.error);
          throw new Error(`Upload failed for ${file.name}`);
        }

        uploaded.push(data.document);
      }

      return uploaded;
    },
    onSuccess: (uploadedDocuments) => {
      setSelectedCount(0);

      toast.success("Documents uploaded", {
        description: `${uploadedDocuments.length} file(s) uploaded successfully.`,
      });

      void queryClient.invalidateQueries({ queryKey: ["documents"] });

      reset({ files: [] });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err) => {
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : "Unknown error.",
      });
    },
  });

  const onSubmit = async (values: UploadFormValues) => {
    uploadMutation.mutate(values.files);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/documents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json()) as { success?: boolean; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to delete document");
      }
      if (!data.success) {
        throw new Error(data.error ?? "Failed to delete document");
      }
    },
    onSuccess: (_, deletedId) => {
      queryClient.setQueryData<DocumentListItem[]>(["documents"], (prev) =>
        (prev ?? []).filter((doc) => doc.id !== deletedId),
      );
      toast.success("Document deleted");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err) => {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : "Unknown error.",
      });
    },
  });

  return (
    <section className="h-full min-h-0 flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload New Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Select one or more PDF files to upload.
            </p>

            <Controller
              control={control}
              name="files"
              render={({ field }) => (
                <Input
                  type="file"
                  multiple
                  accept="application/pdf"
                  ref={(el) => {
                    field.ref(el);
                    fileInputRef.current = el;
                  }}
                  onChange={(e) => {
                    const nextFiles = e.target.files
                      ? Array.from(e.target.files)
                      : [];
                    field.onChange(nextFiles);
                    setSelectedCount(nextFiles.length);
                  }}
                />
              )}
            />

            {errors.files ? (
              <p className="text-sm text-destructive">{errors.files.message}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="submit"
                disabled={uploadMutation.isPending || selectedCount === 0}
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="min-h-0 flex flex-1 flex-col">
        <CardHeader>
          <CardTitle className="text-base">
            View Previously Uploaded Documents
          </CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto pr-2">
            {documentsLoading ? (
              <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 rounded-lg border bg-background/50 px-3 py-6 text-center text-sm text-muted-foreground">
                <FileText className="size-4 animate-pulse" />
                <div>Loading documents…</div>
              </div>
            ) : documentsError ? (
              <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-6 text-center text-sm text-destructive">
                <div>Could not load documents.</div>
                <div className="text-xs opacity-90">
                  {documentsErrorObj instanceof Error
                    ? documentsErrorObj.message
                    : "Unknown error."}
                </div>
              </div>
            ) : documents.length === 0 ? (
              <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 rounded-lg border bg-background/50 px-3 py-6 text-center text-sm text-muted-foreground">
                <FileText className="size-4" />
                <div>No documents uploaded yet.</div>
                <div className="text-xs">Use “Upload New Documents” above to add files.</div>
              </div>
            ) : (
              <ul className="space-y-3">
                {documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="min-h-20 rounded-lg border bg-background px-3 py-2 transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
                  >
                    <div className="flex min-h-14 items-start justify-between gap-2">
                      <a
                        href={`/api/documents/${doc.id}/open`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 rounded-md outline-none transition-colors"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {doc.name}
                          </span>
                          <ProcessingStatusBadge
                            status={doc.processing_status ?? "pending"}
                          />
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {documentSubtitle(doc)}
                        </div>
                        {doc.processing_status === "failed" &&
                        doc.processing_error ? (
                          <p
                            className="mt-1 line-clamp-2 text-xs text-destructive/90"
                            title={doc.processing_error}
                          >
                            {doc.processing_error}
                          </p>
                        ) : null}
                      </a>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        disabled={
                          deleteMutation.isPending &&
                          deleteMutation.variables === doc.id
                        }
                        aria-label={`Remove ${doc.name} from list`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteMutation.mutate(doc.id);
                        }}
                      >
                        <XIcon className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

