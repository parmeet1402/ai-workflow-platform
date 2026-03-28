"use client";

import * as React from "react";
import { FileText, XIcon } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DocumentRow = {
  id: string;
  name: string;
  storage_path: string;
  user_id?: string;
  organization_id?: string;
  created_at?: string | null;
};

function documentSubtitle(doc: DocumentRow): string {
  if (doc.created_at) {
    try {
      return new Date(doc.created_at).toLocaleString();
    } catch {
      return doc.storage_path;
    }
  }
  return doc.storage_path;
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

type UploadDocumentFromApi = {
  id: string;
  name: string;
  storage_path: string;
};

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
    queryFn: async (): Promise<DocumentRow[]> => {
      const res = await fetch("/api/documents", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await res.json()) as
        | { documents: DocumentRow[] }
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
      queryClient.setQueryData<DocumentRow[]>(["documents"], (prev) =>
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
                    className="h-20 rounded-lg border bg-background px-3 py-2 transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
                  >
                    <div className="flex h-full items-start justify-between gap-2">
                      <a
                        href={`/api/documents/${doc.id}/open`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 rounded-md outline-none transition-colors"
                      >
                        <div className="truncate text-sm font-medium">{doc.name}</div>
                        <div className="truncate text-sm text-muted-foreground">
                          {documentSubtitle(doc)}
                        </div>
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

