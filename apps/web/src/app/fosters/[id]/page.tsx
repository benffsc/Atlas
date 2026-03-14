"use client";

import { useParams } from "next/navigation";
import { PersonDetailShell } from "@/components/person";

export default function FosterDetailPage() {
  const params = useParams();
  return (
    <PersonDetailShell
      id={params.id as string}
      initialRole="foster"
      backHref="/fosters"
    />
  );
}
