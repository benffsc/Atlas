import { apiSuccess } from "@/lib/api-response";

// Build timestamp is set at build time
const BUILD_TIME = new Date().toISOString();

export async function GET() {
  return apiSuccess({
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF || "main",
    timestamp: BUILD_TIME,
    environment: process.env.NODE_ENV || "development",
    vercel: process.env.VERCEL === "1",
  });
}
