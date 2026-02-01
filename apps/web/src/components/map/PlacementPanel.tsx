"use client";

import { useState, useEffect, useCallback } from "react";

interface NearbyPlace {
  place_id: string;
  display_name: string;
  place_kind: string | null;
  formatted_address: string;
  cat_count: number;
  person_count: number;
  distance_meters: number;
}

interface PlacementPanelProps {
  mode: 'place' | 'annotation';
  coordinates: { lat: number; lng: number };
  onPlaceSelected: (placeId: string) => void;
  onAnnotationCreated: () => void;
  onCancel: () => void;
}

type AnnotationType = 'general' | 'colony_sighting' | 'trap_location' | 'hazard' | 'feeding_site' | 'other';
type ExpiresOption = 'never' | 'tomorrow' | '1_week' | '1_month' | 'custom';

export function PlacementPanel({ mode, coordinates, onPlaceSelected, onAnnotationCreated, onCancel }: PlacementPanelProps) {
  // Place mode state
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [typedAddress, setTypedAddress] = useState("");
  const [creatingPlace, setCreatingPlace] = useState(false);

  // Annotation mode state
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [annotationType, setAnnotationType] = useState<AnnotationType>('general');
  const [expiresOption, setExpiresOption] = useState<ExpiresOption>('never');
  const [customDate, setCustomDate] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingAnnotation, setSavingAnnotation] = useState(false);

  // Fetch nearby places on mount (place mode only)
  useEffect(() => {
    if (mode === 'place') {
      setLoadingNearby(true);
      fetch(`/api/places/nearby?lat=${coordinates.lat}&lng=${coordinates.lng}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load nearby places");
          return res.json();
        })
        .then((data) => {
          setNearbyPlaces(data.existing_places || []);
          setLoadingNearby(false);
        })
        .catch((err) => {
          console.error("Error fetching nearby places:", err);
          setLoadingNearby(false);
        });
    }
  }, [mode, coordinates]);

  // Handle "Drop Pin Here" - creates place from coordinates
  const handleDropPin = useCallback(async () => {
    setCreatingPlace(true);
    try {
      const res = await fetch('/api/places/from-coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: coordinates.lat,
          lng: coordinates.lng,
        }),
      });

      if (!res.ok) throw new Error("Failed to create place");

      const data = await res.json();
      onPlaceSelected(data.place_id);
    } catch (err) {
      console.error("Error creating place:", err);
      alert("Failed to create place from coordinates");
    } finally {
      setCreatingPlace(false);
    }
  }, [coordinates, onPlaceSelected]);

  // Handle creating place from typed address
  const handleCreateFromAddress = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedAddress.trim()) return;

    setCreatingPlace(true);
    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: typedAddress,
          lat: coordinates.lat,
          lng: coordinates.lng,
        }),
      });

      if (!res.ok) throw new Error("Failed to create place");

      const data = await res.json();
      onPlaceSelected(data.place_id);
    } catch (err) {
      console.error("Error creating place from address:", err);
      alert("Failed to create place from address");
    } finally {
      setCreatingPlace(false);
    }
  }, [typedAddress, coordinates, onPlaceSelected]);

  // Handle photo upload
  const handlePhotoUpload = useCallback(async (file: File) => {
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity_type', 'annotation');
      formData.append('entity_id', 'temp'); // placeholder

      const res = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error("Failed to upload photo");

      const data = await res.json();
      setUploadedPhotoUrl(data.storage_path || data.url);
    } catch (err) {
      console.error("Error uploading photo:", err);
      alert("Failed to upload photo");
    } finally {
      setUploadingPhoto(false);
    }
  }, []);

  // Handle annotation save
  const handleSaveAnnotation = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      alert("Label is required");
      return;
    }

    setSavingAnnotation(true);
    try {
      // Calculate expiration date
      let expiresAt: string | null = null;
      if (expiresOption === 'tomorrow') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        expiresAt = tomorrow.toISOString();
      } else if (expiresOption === '1_week') {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        expiresAt = nextWeek.toISOString();
      } else if (expiresOption === '1_month') {
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        expiresAt = nextMonth.toISOString();
      } else if (expiresOption === 'custom' && customDate) {
        expiresAt = new Date(customDate).toISOString();
      }

      const res = await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          note: note.trim() || null,
          type: annotationType,
          lat: coordinates.lat,
          lng: coordinates.lng,
          expires_at: expiresAt,
          photo_url: uploadedPhotoUrl,
        }),
      });

      if (!res.ok) throw new Error("Failed to create annotation");

      onAnnotationCreated();
    } catch (err) {
      console.error("Error creating annotation:", err);
      alert("Failed to create annotation");
    } finally {
      setSavingAnnotation(false);
    }
  }, [label, note, annotationType, expiresOption, customDate, coordinates, uploadedPhotoUrl, onAnnotationCreated]);

  const nearbyWithin25m = nearbyPlaces.filter(p => p.distance_meters <= 25);

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 0,
      bottom: 0,
      width: '380px',
      backgroundColor: 'white',
      boxShadow: '-2px 0 8px rgba(0,0,0,0.15)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
    }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#1f2937',
        color: 'white',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {mode === 'place' ? 'Add Place' : 'Add Note'}
          </h2>
          <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '4px' }}>
            {coordinates.lat.toFixed(6)}, {coordinates.lng.toFixed(6)}
          </div>
        </div>
        <button
          onClick={onCancel}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            fontSize: '24px',
            cursor: 'pointer',
            padding: '0 4px',
          }}
        >
          &times;
        </button>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
      }}>
        {mode === 'place' ? (
          <>
            {/* Nearby places section */}
            {loadingNearby && (
              <div style={{ textAlign: 'center', color: '#6b7280', padding: '20px' }}>
                Loading nearby places...
              </div>
            )}

            {!loadingNearby && nearbyWithin25m.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>
                  Attach to nearby place:
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {nearbyWithin25m.map((place) => (
                    <button
                      key={place.place_id}
                      onClick={() => onPlaceSelected(place.place_id)}
                      style={{
                        padding: '12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        backgroundColor: 'white',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#3b82f6';
                        e.currentTarget.style.backgroundColor = '#eff6ff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#d1d5db';
                        e.currentTarget.style.backgroundColor = 'white';
                      }}
                    >
                      <div style={{ fontWeight: 500, fontSize: '14px', color: '#111827', marginBottom: '4px' }}>
                        {place.display_name || place.formatted_address}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                        {place.formatted_address}
                      </div>
                      <div style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', gap: '12px' }}>
                        <span>{place.distance_meters}m away</span>
                        {place.cat_count > 0 && <span>{place.cat_count} cats</span>}
                        {place.person_count > 0 && <span>{place.person_count} people</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Drop pin section */}
            <div style={{ marginBottom: '24px' }}>
              <button
                onClick={handleDropPin}
                disabled={creatingPlace}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: creatingPlace ? 'not-allowed' : 'pointer',
                  opacity: creatingPlace ? 0.6 : 1,
                }}
              >
                {creatingPlace ? 'Creating...' : '📍 Drop Pin Here'}
              </button>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px', textAlign: 'center' }}>
                Creates a new place at this exact location
              </div>
            </div>

            {/* Type address section */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>
                Or type an address:
              </h3>
              <form onSubmit={handleCreateFromAddress}>
                <input
                  type="text"
                  value={typedAddress}
                  onChange={(e) => setTypedAddress(e.target.value)}
                  placeholder="123 Main St, City, CA"
                  disabled={creatingPlace}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    marginBottom: '8px',
                  }}
                />
                <button
                  type="submit"
                  disabled={!typedAddress.trim() || creatingPlace}
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: typedAddress.trim() && !creatingPlace ? '#059669' : '#d1d5db',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: typedAddress.trim() && !creatingPlace ? 'pointer' : 'not-allowed',
                  }}
                >
                  {creatingPlace ? 'Creating...' : 'Create Place'}
                </button>
              </form>
            </div>
          </>
        ) : (
          // Annotation mode
          <form onSubmit={handleSaveAnnotation}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                Label <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value.slice(0, 100))}
                placeholder="Brief description"
                maxLength={100}
                required
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              />
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                {label.length}/100
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                Note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 2000))}
                placeholder="Additional details..."
                maxLength={2000}
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                {note.length}/2000
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                Type
              </label>
              <select
                value={annotationType}
                onChange={(e) => setAnnotationType(e.target.value as AnnotationType)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: 'white',
                }}
              >
                <option value="general">General</option>
                <option value="colony_sighting">Colony Sighting</option>
                <option value="trap_location">Trap Location</option>
                <option value="hazard">Hazard</option>
                <option value="feeding_site">Feeding Site</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                Expires
              </label>
              <select
                value={expiresOption}
                onChange={(e) => setExpiresOption(e.target.value as ExpiresOption)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: 'white',
                  marginBottom: expiresOption === 'custom' ? '8px' : 0,
                }}
              >
                <option value="never">Never</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="1_week">1 Week</option>
                <option value="1_month">1 Month</option>
                <option value="custom">Custom Date</option>
              </select>
              {expiresOption === 'custom' && (
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                  }}
                />
              )}
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                Photo (optional)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setPhotoFile(file);
                    handlePhotoUpload(file);
                  }
                }}
                disabled={uploadingPhoto}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '13px',
                  backgroundColor: 'white',
                }}
              />
              {uploadingPhoto && (
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
                  Uploading photo...
                </div>
              )}
              {uploadedPhotoUrl && (
                <div style={{ fontSize: '12px', color: '#059669', marginTop: '6px' }}>
                  ✓ Photo uploaded
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onCancel}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!label.trim() || savingAnnotation}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: label.trim() && !savingAnnotation ? '#3b82f6' : '#d1d5db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: label.trim() && !savingAnnotation ? 'pointer' : 'not-allowed',
                }}
              >
                {savingAnnotation ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
