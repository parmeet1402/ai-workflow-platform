export type ProcessingStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export type DocumentListItem = {
  id: string;
  name: string;
  storage_path: string;
  user_id?: string;
  organization_id?: string;
  created_at?: string | null;
  processing_status: ProcessingStatus;
  processing_error?: string | null;
  processed_at?: string | null;
};
