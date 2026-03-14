"use client";

import { useParams } from "next/navigation";
import { PersonDetailShell } from "@/components/person";

export default function PersonDetailPage() {
  const params = useParams();
  return <PersonDetailShell id={params.id as string} />;
}
