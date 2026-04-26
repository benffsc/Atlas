"use client";

import { useParams } from "next/navigation";
import { RequestDetailShell } from "@/components/request/RequestDetailShell";

export default function RequestDetailPage() {
  const params = useParams();
  return <RequestDetailShell id={params.id as string} />;
}
