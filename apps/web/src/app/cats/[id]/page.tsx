"use client";

import { useParams } from "next/navigation";
import { CatDetailShell } from "@/components/cat";

export default function CatDetailPage() {
  const params = useParams();
  return <CatDetailShell id={params.id as string} />;
}
