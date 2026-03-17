"use client";

import { useParams } from "next/navigation";
import { PlaceDetailShell } from "@/components/place";

export default function PlaceDetailPage() {
  const params = useParams();
  return <PlaceDetailShell id={params.id as string} />;
}
