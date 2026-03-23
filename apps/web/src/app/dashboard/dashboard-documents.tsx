"use client";

import * as React from "react";
import { FileText, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DocumentItem = {
  id: string;
  name: string;
  description: string;
};

const INITIAL_DOCUMENTS: DocumentItem[] = [
  { id: "doc-1", name: "Document 1", description: "Description of Document 1" },
  { id: "doc-2", name: "Document 2", description: "Description of Document 2" },
  { id: "doc-3", name: "Document 3", description: "Description of Document 3" },
  { id: "doc-4", name: "Document 4", description: "Description of Document 4" },
  { id: "doc-5", name: "Document 5", description: "Description of Document 5" },
  { id: "doc-6", name: "Document 6", description: "Description of Document 6" },
  { id: "doc-7", name: "Document 7", description: "Description of Document 7" },
  { id: "doc-8", name: "Document 8", description: "Description of Document 8" },
  { id: "doc-9", name: "Document 9", description: "Description of Document 9" },
  { id: "doc-10", name: "Document 10", description: "Description of Document 10" },
];

export default function DashboardDocuments() {
  const [documents, setDocuments] = React.useState(INITIAL_DOCUMENTS);
  const [selectedFiles, setSelectedFiles] = React.useState<FileList | null>(null);

  const handleUpload = () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      toast.info("No files selected", {
        description: "Pick at least one file to upload.",
      });
      return;
    }

    // Dummy upload handler for now.
    toast.success("Dummy upload handler called", {
      description: `${selectedFiles.length} file(s) selected.`,
    });
    console.log("Dummy upload files:", Array.from(selectedFiles).map((file) => file.name));
  };

  const handleDeleteDocument = (id: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));

    // Dummy delete handler for now.
    toast.success("Dummy delete handler called", {
      description: `Deleted document id: ${id}`,
    });
    console.log("Dummy delete document:", id);
  };

  return (
    <section className="h-full min-h-0 flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload New Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select one or more files to upload.
          </p>

          <Input
            type="file"
            multiple
            onChange={(e) => setSelectedFiles(e.target.files)}
          />

          <div className="flex justify-end">
            <Button type="button" onClick={handleUpload}>
              Upload
            </Button>
          </div>
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
            {documents.length === 0 ? (
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
                    className="h-20 rounded-lg border bg-background px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{doc.name}</div>
                        <div className="truncate text-sm text-muted-foreground">
                          {doc.description}
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${doc.name}`}
                        onClick={() => handleDeleteDocument(doc.id)}
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

