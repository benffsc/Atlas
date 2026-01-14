import { createClient } from "@supabase/supabase-js";

// Supabase client for storage operations
// Uses service role key for server-side operations (uploads, deletes)

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("Supabase credentials not configured - storage features disabled");
}

export const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

// Storage bucket name for request media
export const MEDIA_BUCKET = "request-media";

/**
 * Get public URL for a file in storage
 */
export function getPublicUrl(path: string): string {
  if (!supabase) {
    // Fallback to local path if Supabase not configured
    return `/uploads/media/${path}`;
  }

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload a file to Supabase Storage
 */
export async function uploadFile(
  path: string,
  file: Buffer | Blob,
  contentType: string
): Promise<{ success: boolean; path?: string; url?: string; error?: string }> {
  if (!supabase) {
    return { success: false, error: "Supabase not configured" };
  }

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, {
      contentType,
      upsert: true,
    });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    path: data.path,
    url: getPublicUrl(data.path),
  };
}

/**
 * Delete a file from Supabase Storage
 */
export async function deleteFile(path: string): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  return !error;
}

/**
 * Check if Supabase Storage is available
 */
export function isStorageAvailable(): boolean {
  return supabase !== null;
}
