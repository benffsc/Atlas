import { PlaceResolver } from "@/components/forms";
import type { LocationStepProps } from "./types";

export default function LocationStep({
  formData,
  updateField,
  errors,
  showAddressSelection,
  personAddresses,
  selectedAddressId,
  handleKnownAddressSelect,
  onSelectNewAddress,
  resolvedCatPlace,
  handleCatPlaceResolved,
  selectedPlaceId,
  catsAtMyAddress,
  setCatsAtMyAddress,
  resolvedRequesterPlace,
  handleRequesterPlaceResolved,
  selectedPersonId,
}: LocationStepProps) {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Cat Location</h2>

      {/* Known addresses for selected person */}
      {showAddressSelection && personAddresses.length > 0 && (
        <div style={{
          marginBottom: "1.5rem",
          padding: "1rem",
          background: "#e7f1ff",
          border: "1px solid #b8daff",
          borderRadius: "8px",
        }}>
          <p style={{ margin: "0 0 0.75rem 0", fontWeight: 500 }}>
            Known addresses for {formData.first_name}:
          </p>

          {/* Cats at my address checkbox */}
          <label style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.75rem",
            cursor: "pointer",
            padding: "0.5rem",
            background: catsAtMyAddress ? "#d4edda" : "#fff",
            border: `2px solid ${catsAtMyAddress ? "#198754" : "#ddd"}`,
            borderRadius: "6px",
          }}>
            <input
              type="checkbox"
              checked={catsAtMyAddress}
              onChange={(e) => setCatsAtMyAddress(e.target.checked)}
            />
            <span>Cats are at my address</span>
          </label>

          {/* Address options */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {personAddresses.map((addr) => (
              <label
                key={addr.place_id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  padding: "0.75rem",
                  border: `2px solid ${selectedAddressId === addr.place_id ? "#0066cc" : "#ddd"}`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: selectedAddressId === addr.place_id ? "#fff" : "#f8f9fa",
                }}
              >
                <input
                  type="radio"
                  name="known_address"
                  checked={selectedAddressId === addr.place_id}
                  onChange={() => handleKnownAddressSelect(addr)}
                />
                <span>
                  <span style={{ display: "block" }}>{addr.formatted_address}</span>
                  {addr.role && (
                    <span style={{ fontSize: "0.75rem", color: "#666" }}>
                      ({addr.role})
                    </span>
                  )}
                </span>
              </label>
            ))}

            {/* Enter different address option */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem",
                border: `2px solid ${selectedAddressId === "new" ? "#0066cc" : "#ddd"}`,
                borderRadius: "6px",
                cursor: "pointer",
                background: selectedAddressId === "new" ? "#fff" : "#f8f9fa",
              }}
            >
              <input
                type="radio"
                name="known_address"
                checked={selectedAddressId === "new"}
                onChange={onSelectNewAddress}
              />
              <span>Enter a different address</span>
            </label>
          </div>
        </div>
      )}

      {/* Address input - show always if no known addresses, or if "new" selected */}
      {(!showAddressSelection || selectedAddressId === "new" || personAddresses.length === 0) && (
        <div>
          <label>Street Address *</label>
          <PlaceResolver
            value={resolvedCatPlace}
            onChange={handleCatPlaceResolved}
            placeholder="Start typing address..."
          />
          {errors.cats_address && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{errors.cats_address}</span>}
          {selectedPlaceId && selectedAddressId !== "new" && (
            <span style={{ fontSize: "0.75rem", color: "#198754", marginTop: "0.25rem", display: "block" }}>
              Address verified
            </span>
          )}
        </div>
      )}

      {/* Show selected address summary when using known address */}
      {showAddressSelection && selectedAddressId && selectedAddressId !== "new" && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.75rem",
          background: "#d4edda",
          border: "1px solid #c3e6cb",
          borderRadius: "6px",
        }}>
          <span style={{ fontWeight: 500 }}>Selected: </span>
          {formData.cats_address}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
        <input
          type="text"
          value={formData.cats_city}
          onChange={(e) => updateField("cats_city", e.target.value)}
          placeholder="City"
        />
        <input
          type="text"
          value={formData.cats_zip}
          onChange={(e) => updateField("cats_zip", e.target.value)}
          placeholder="ZIP"
        />
      </div>

      <div style={{ marginTop: "1rem" }}>
        <label>County</label>
        <select
          value={formData.county}
          onChange={(e) => updateField("county", e.target.value)}
        >
          <option value="">Select...</option>
          <option value="Sonoma">Sonoma</option>
          <option value="Marin">Marin</option>
          <option value="Napa">Napa</option>
          <option value="Mendocino">Mendocino</option>
          <option value="Lake">Lake</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Requester home address - show when cats are NOT at requester's address */}
      {!catsAtMyAddress && selectedPersonId && (
        <div style={{
          marginTop: "1.5rem",
          padding: "1rem",
          background: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: "8px",
        }}>
          <p style={{ margin: "0 0 0.75rem 0", fontWeight: 500 }}>
            Your Home Address (Optional)
          </p>
          <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.75rem" }}>
            Since the cats are at a different location, you can optionally provide your home address.
          </p>
          <PlaceResolver
            value={resolvedRequesterPlace}
            onChange={handleRequesterPlaceResolved}
            placeholder="Start typing your home address..."
            allowCreate={false}
          />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.5rem", marginTop: "0.5rem" }}>
            <input
              type="text"
              value={formData.requester_city}
              onChange={(e) => updateField("requester_city", e.target.value)}
              placeholder="City"
              style={{ fontSize: "0.9rem", padding: "0.5rem" }}
            />
            <input
              type="text"
              value={formData.requester_zip}
              onChange={(e) => updateField("requester_zip", e.target.value)}
              placeholder="ZIP"
              style={{ fontSize: "0.9rem", padding: "0.5rem" }}
            />
          </div>
        </div>
      )}

      {/* Quick check: is caller at location? */}
      <div style={{ marginTop: "1.5rem", background: "var(--section-bg)", padding: "1rem", borderRadius: "8px" }}>
        <div style={{ marginBottom: "1rem" }}>
          <label>Is caller the property owner?</label>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
            {["yes", "no", "unsure"].map((v) => (
              <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="is_property_owner"
                  value={v}
                  checked={formData.is_property_owner === v}
                  onChange={(e) => updateField("is_property_owner", e.target.value)}
                />
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label>Do they have access to trap/catch the cats?</label>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
            {["yes", "no", "unsure"].map((v) => (
              <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="has_property_access"
                  value={v}
                  checked={formData.has_property_access === v}
                  onChange={(e) => updateField("has_property_access", e.target.value)}
                />
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
