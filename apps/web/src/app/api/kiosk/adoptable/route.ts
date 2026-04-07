import { NextResponse } from "next/server";
import { apiSuccess } from "@/lib/api-response";

/**
 * GET /api/kiosk/adoptable
 *
 * Returns a list of adoptable cats from ShelterLuv, projected to a minimal
 * kiosk-safe shape. Cached at the edge for 30 minutes so visiting the kiosk
 * page does not hammer the upstream API.
 *
 * On any upstream failure (missing key, network, parse error) we return an
 * empty array — the kiosk page handles that as an "empty state" rather than
 * crashing the lobby display.
 */

const SHELTERLUV_API_KEY = process.env.SHELTERLUV_API_KEY;
const API_BASE_URL = "https://www.shelterluv.com/api/v1";

// Cache the route response for 30 minutes
export const revalidate = 1800;

interface ShelterLuvAnimal {
  Internal_ID?: string;
  ID?: string;
  Name?: string;
  Type?: string;
  Species?: string;
  Status?: string;
  Sex?: string;
  Age?: string;
  Breed?: string;
  Description?: string;
  Photos?: string[];
  CoverPhoto?: string;
  Url?: string;
}

interface KioskAnimal {
  id: string;
  name: string;
  age: string | null;
  sex: string | null;
  breed: string | null;
  description: string | null;
  primaryPhoto: string | null;
  photos: string[];
  url: string | null;
}

function projectAnimal(raw: ShelterLuvAnimal): KioskAnimal | null {
  const id = String(raw.Internal_ID || raw.ID || "");
  if (!id) return null;
  const photos = Array.isArray(raw.Photos) ? raw.Photos.filter(Boolean) : [];
  const primaryPhoto = raw.CoverPhoto || photos[0] || null;
  // Skip animals with no photo — kiosk slideshow needs imagery
  if (!primaryPhoto) return null;
  return {
    id,
    name: raw.Name || "Unnamed",
    age: raw.Age || null,
    sex: raw.Sex || null,
    breed: raw.Breed || null,
    description: raw.Description || null,
    primaryPhoto,
    photos,
    url: raw.Url || null,
  };
}

async function fetchPublishableCats(): Promise<KioskAnimal[]> {
  if (!SHELTERLUV_API_KEY) {
    console.error("[kiosk/adoptable] SHELTERLUV_API_KEY not configured");
    return [];
  }

  const url = new URL(`${API_BASE_URL}/animals`);
  url.searchParams.set("status_type", "publishable");
  url.searchParams.set("offset", "0");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "X-Api-Key": SHELTERLUV_API_KEY },
      // Honor the route-level revalidate
      next: { revalidate: 1800 },
    });
  } catch (err) {
    console.error("[kiosk/adoptable] fetch failed:", err);
    return [];
  }

  if (!res.ok) {
    console.error("[kiosk/adoptable] upstream error:", res.status);
    return [];
  }

  let data: { animals?: ShelterLuvAnimal[] };
  try {
    data = (await res.json()) as { animals?: ShelterLuvAnimal[] };
  } catch (err) {
    console.error("[kiosk/adoptable] json parse failed:", err);
    return [];
  }

  const animals = Array.isArray(data.animals) ? data.animals : [];
  // Filter to cats only — clinic/kiosk audience is here for cats
  const cats = animals.filter((a) => {
    const t = (a.Type || a.Species || "").toLowerCase();
    return t === "cat" || t.includes("cat");
  });

  const projected = cats
    .map(projectAnimal)
    .filter((a): a is KioskAnimal => a !== null);

  return projected;
}

export async function GET(): Promise<NextResponse> {
  const animals = await fetchPublishableCats();
  return apiSuccess(
    { animals },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } },
  );
}
