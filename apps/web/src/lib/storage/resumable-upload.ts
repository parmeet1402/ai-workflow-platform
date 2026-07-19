import * as tus from "tus-js-client";
import { createClient } from "@/lib/supabase/client";

const RESUMABLE_UPLOAD_PATH = "/storage/v1/upload/resumable";
const CHUNK_SIZE = 6 * 1024 * 1024; // Supabase Storage's resumable endpoint requires 6MB chunks.

export type ResumableUploadTarget = {
    bucket: string;
    storagePath: string;
    contentType: string;
};

/**
 * Uploads `file` straight to Supabase Storage's resumable (TUS) endpoint, bypassing the
 * Next.js backend entirely so large files are not bound by platform request-body limits.
 * The caller's session access token authorizes the write; org-scoped Storage RLS policies
 * (see supabase/migrations) decide whether the write to `storagePath` is allowed.
 */
export function uploadFileResumable(
    file: File,
    target: ResumableUploadTarget,
    onProgress?: (bytesUploaded: number, bytesTotal: number) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        void (async () => {
            const supabase = createClient();
            const { data, error } = await supabase.auth.getSession();
            const accessToken = data.session?.access_token;

            if (error || !accessToken) {
                reject(new Error("Not signed in"));
                return;
            }

            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            if (!supabaseUrl) {
                reject(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"));
                return;
            }

            const upload = new tus.Upload(file, {
                endpoint: `${supabaseUrl}${RESUMABLE_UPLOAD_PATH}`,
                retryDelays: [0, 1000, 3000, 5000],
                chunkSize: CHUNK_SIZE,
                headers: {
                    authorization: `Bearer ${accessToken}`,
                    // Never allow an upload to silently overwrite an existing object.
                    "x-upsert": "false",
                },
                metadata: {
                    bucketName: target.bucket,
                    objectName: target.storagePath,
                    contentType: target.contentType,
                },
                onError: (uploadError) => reject(uploadError),
                onProgress: (bytesUploaded, bytesTotal) => {
                    onProgress?.(bytesUploaded, bytesTotal);
                },
                onSuccess: () => resolve(),
            });

            const previousUploads = await upload.findPreviousUploads();
            if (previousUploads.length > 0) {
                upload.resumeFromPreviousUpload(previousUploads[0]!);
            }
            upload.start();
        })();
    });
}
