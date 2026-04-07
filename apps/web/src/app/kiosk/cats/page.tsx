"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api-client";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/feedback/Skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";

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

const AUTO_ADVANCE_MS = 8000;

/**
 * Adoptable Cats — kiosk slideshow.
 *
 * Shows publishable cats from ShelterLuv (cached at the API route).
 * Auto-advances every 8 seconds; tap left/right edges or use arrow buttons
 * to manually navigate. Visitors can read about each cat while they wait.
 */
export default function KioskCatsPage() {
  const router = useRouter();
  const [animals, setAnimals] = useState<KioskAnimal[] | null>(null);
  const [error, setError] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchApi<{ animals: KioskAnimal[] }>("/api/kiosk/adoptable")
      .then((data) => {
        if (cancelled) return;
        setAnimals(data.animals || []);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setAnimals([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const total = animals?.length ?? 0;

  const next = useCallback(() => {
    if (total <= 1) return;
    setIndex((i) => (i + 1) % total);
  }, [total]);

  const prev = useCallback(() => {
    if (total <= 1) return;
    setIndex((i) => (i - 1 + total) % total);
  }, [total]);

  // Auto-advance
  useEffect(() => {
    if (total <= 1) return;
    const id = setInterval(next, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [next, total]);

  // Keyboard navigation (helps if a USB keyboard is plugged into the kiosk)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") router.push("/kiosk");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, router]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg, #fff)",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 1.25rem",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Button
          variant="ghost"
          size="lg"
          icon="arrow-left"
          onClick={() => router.push("/kiosk")}
          style={{ minHeight: 48, borderRadius: 12 }}
        >
          Back
        </Button>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Icon name="cat" size={20} color="var(--primary)" />
          <h1 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>
            Adoptable Cats
          </h1>
        </div>
        <div style={{ width: 96 }} /> {/* spacer to keep title centered */}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "1.5rem" }}>
        {animals === null && <CardSkeleton />}
        {animals !== null && animals.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <EmptyState
              size="lg"
              title={error ? "Couldn't load adoptable cats" : "No cats currently available"}
              description={
                error
                  ? "We're having trouble reaching the adoption system. Please check back soon."
                  : "Check back soon — new cats become available every week."
              }
              action={{ label: "Back to Home", onClick: () => router.push("/kiosk") }}
            />
          </div>
        )}
        {animals !== null && animals.length > 0 && (
          <CatCard
            animal={animals[index]}
            currentIndex={index}
            total={total}
            onNext={next}
            onPrev={prev}
          />
        )}
      </div>
    </div>
  );
}

function CatCard({
  animal,
  currentIndex,
  total,
  onNext,
  onPrev,
}: {
  animal: KioskAnimal;
  currentIndex: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        maxWidth: 720,
        margin: "0 auto",
        width: "100%",
      }}
    >
      {/* Photo */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 3",
          borderRadius: 16,
          overflow: "hidden",
          background: "var(--muted-bg, #f3f4f6)",
          boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.1))",
        }}
      >
        {animal.primaryPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={animal.primaryPhoto}
            alt={animal.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}

        {/* Edge tap zones for navigation */}
        {total > 1 && (
          <>
            <button
              onClick={onPrev}
              aria-label="Previous cat"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "20%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            />
            <button
              onClick={onNext}
              aria-label="Next cat"
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: "20%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            />
          </>
        )}

        {/* Counter pill */}
        {total > 1 && (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              padding: "0.25rem 0.625rem",
              background: "rgba(0, 0, 0, 0.55)",
              color: "#fff",
              borderRadius: 999,
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            {currentIndex + 1} / {total}
          </div>
        )}
      </div>

      {/* Name + meta */}
      <div>
        <h2 style={{ fontSize: "2rem", fontWeight: 700, margin: "0 0 0.25rem" }}>
          {animal.name}
        </h2>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            color: "var(--text-secondary)",
            fontSize: "0.95rem",
          }}
        >
          {animal.age && <Pill>{animal.age}</Pill>}
          {animal.sex && <Pill>{animal.sex}</Pill>}
          {animal.breed && <Pill>{animal.breed}</Pill>}
        </div>
      </div>

      {/* Description */}
      {animal.description && (
        <p
          style={{
            margin: 0,
            fontSize: "1rem",
            lineHeight: 1.5,
            color: "var(--text-primary)",
            // Cap to a few lines so very long bios don't overflow on a kiosk
            display: "-webkit-box",
            WebkitLineClamp: 6,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {animal.description}
        </p>
      )}

      {/* Manual nav buttons */}
      {total > 1 && (
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "auto", paddingTop: "1rem" }}>
          <Button
            variant="outline"
            size="lg"
            icon="chevron-left"
            fullWidth
            onClick={onPrev}
            style={{ minHeight: 56, borderRadius: 12 }}
          >
            Previous
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon="chevron-right"
            fullWidth
            onClick={onNext}
            style={{ minHeight: 56, borderRadius: 12 }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.25rem 0.625rem",
        background: "var(--muted-bg, #f3f4f6)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        fontSize: "0.85rem",
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

function CardSkeleton() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        maxWidth: 720,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <Skeleton width="100%" height={0} style={{ aspectRatio: "4 / 3", borderRadius: 16 }} />
      <Skeleton width="60%" height={32} />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Skeleton width={60} height={24} borderRadius={999} />
        <Skeleton width={60} height={24} borderRadius={999} />
        <Skeleton width={80} height={24} borderRadius={999} />
      </div>
      <Skeleton width="100%" height={16} />
      <Skeleton width="90%" height={16} />
      <Skeleton width="80%" height={16} />
    </div>
  );
}
