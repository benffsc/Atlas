"use client";

import { useState } from "react";
import type { IntakeSubmission } from "@/lib/intake-types";
import { normalizeName } from "@/components/intake/IntakeBadges";

interface BookingModalProps {
  submission: IntakeSubmission;
  isOpen: boolean;
  onClose: () => void;
  onBooked: (bookingDate: string, bookingNotes: string) => void;
  saving: boolean;
  initialDate?: string;
}

export function BookingModal({
  submission,
  isOpen,
  onClose,
  onBooked,
  saving,
  initialDate = "",
}: BookingModalProps) {
  const [bookingDate, setBookingDate] = useState(initialDate);
  const [bookingNotes, setBookingNotes] = useState("");

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1002,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--background)",
          borderRadius: "12px",
          padding: "1.5rem",
          maxWidth: "450px",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 0.5rem" }}>
          {submission.legacy_submission_status === "Booked" ? "Change Appointment" : "Book Appointment"}
        </h2>
        <p style={{ color: "var(--muted)", margin: "0 0 1rem", fontSize: "0.9rem" }}>
          {normalizeName(submission.submitter_name)} - {submission.geo_formatted_address || submission.cats_address}
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem", fontWeight: 500 }}>
            Appointment Date
          </label>
          <input
            type="date"
            value={bookingDate}
            onChange={(e) => setBookingDate(e.target.value)}
            style={{ width: "100%", padding: "0.5rem", fontSize: "1rem" }}
          />
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
            Optional - leave blank if date TBD
          </p>
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem", fontWeight: 500 }}>
            Notes (optional)
          </label>
          <textarea
            value={bookingNotes}
            onChange={(e) => setBookingNotes(e.target.value)}
            placeholder="e.g., Booked for morning drop-off, 3 cats confirmed..."
            rows={2}
            style={{ width: "100%", padding: "0.5rem", resize: "vertical" }}
          />
        </div>

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onBooked(bookingDate, bookingNotes)}
            disabled={saving}
            style={{
              padding: "0.5rem 1rem",
              background: "#198754",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {saving ? "Saving..." : submission.legacy_submission_status === "Booked" ? "Update Booking" : "Confirm Booking"}
          </button>
        </div>
      </div>
    </div>
  );
}
