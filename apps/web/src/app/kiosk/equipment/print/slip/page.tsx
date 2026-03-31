"use client";

/**
 * Kiosk version of checkout slips — re-exports the equipment print page.
 * Both /equipment/print/slips (main app) and /kiosk/equipment/print/slip (kiosk)
 * render the same component.
 */
import CheckoutSlipsPage from "@/app/equipment/print/slips/page";

export default function KioskCheckoutSlipPage() {
  return <CheckoutSlipsPage />;
}
