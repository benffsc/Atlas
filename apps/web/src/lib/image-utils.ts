/**
 * Client-side image compression utility.
 *
 * Extracted from MediaUploader for reuse in kiosk photo capture
 * and anywhere else client-side image compression is needed.
 */

/**
 * Compress an image file to JPEG to stay within upload size limits.
 * Retina screenshots can be 5-10MB as PNG; this brings them to ~200-500KB.
 *
 * - Skips non-image files and GIFs
 * - Skips files under 2MB (already small enough)
 * - Resizes to max dimension (default 2048px)
 * - Outputs JPEG at given quality (default 85%)
 * - Returns original file if compression doesn't reduce size
 */
export function compressImage(
  file: File,
  maxDim = 2048,
  quality = 0.85
): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.type === "image/gif") {
      resolve(file);
      return;
    }
    // Skip compression for small files (under 2MB)
    if (file.size < 2 * 1024 * 1024) {
      resolve(file);
      return;
    }
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      // Clean up blob URL immediately after image loads
      URL.revokeObjectURL(blobUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file);
            return;
          }
          const ext = file.name.replace(/\.[^.]+$/, "");
          resolve(new File([blob], `${ext}.jpg`, { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      resolve(file);
    };
    img.src = blobUrl;
  });
}
