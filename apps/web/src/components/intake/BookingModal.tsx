"use client";

import { useState } from "react";
import type { IntakeSubmission } from "@/lib/intake-types";
import { normalizeName } from "@/components/intake/IntakeBadges";
import { Modal } from "@/components/ui";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";

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

  const footer = (
    <>
      <button
        onClick={onClose}
        style={{
          padding: `${SPACING.sm} ${SPACING.lg}`,
          border: "1px solid var(--border)",
          borderRadius: BORDERS.radius.lg,
          cursor: "pointer",
          background: "transparent",
        }}
      >
        Cancel
      </button>
      <button
        onClick={() => onBooked(bookingDate, bookingNotes)}
        disabled={saving}
        style={{
          padding: `${SPACING.sm} ${SPACING.lg}`,
          background: COLORS.success,
          color: COLORS.white,
          border: "none",
          borderRadius: BORDERS.radius.lg,
          cursor: "pointer",
          fontWeight: TYPOGRAPHY.weight.medium,
        }}
      >
        {saving ? "Saving..." : submission.legacy_submission_status === "Booked" ? "Update Booking" : "Confirm Booking"}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={submission.legacy_submission_status === "Booked" ? "Change Appointment" : "Book Appointment"}
      size="sm"
      footer={footer}
    >
      <p style={{ color: "var(--muted)", margin: `0 0 ${SPACING.lg}`, fontSize: TYPOGRAPHY.size.sm }}>
        {normalizeName(submission.submitter_name)} - {submission.geo_formatted_address || submission.cats_address}
      </p>

      <div style={{ marginBottom: SPACING.lg }}>
        <label style={{ display: "block", fontSize: TYPOGRAPHY.size.sm, marginBottom: SPACING.xs, fontWeight: TYPOGRAPHY.weight.medium }}>
          Appointment Date
        </label>
        <input
          type="date"
          value={bookingDate}
          onChange={(e) => setBookingDate(e.target.value)}
          style={{ width: "100%", padding: SPACING.sm, fontSize: TYPOGRAPHY.size.base, boxSizing: "border-box" }}
        />
        <p style={{ margin: `${SPACING.xs} 0 0`, fontSize: TYPOGRAPHY.size.sm, color: "var(--muted)" }}>
          Optional - leave blank if date TBD
        </p>
      </div>

      <div>
        <label style={{ display: "block", fontSize: TYPOGRAPHY.size.sm, marginBottom: SPACING.xs, fontWeight: TYPOGRAPHY.weight.medium }}>
          Notes (optional)
        </label>
        <textarea
          value={bookingNotes}
          onChange={(e) => setBookingNotes(e.target.value)}
          placeholder="e.g., Booked for morning drop-off, 3 cats confirmed..."
          rows={2}
          style={{ width: "100%", padding: SPACING.sm, resize: "vertical", boxSizing: "border-box" }}
        />
      </div>
    </Modal>
  );
}
