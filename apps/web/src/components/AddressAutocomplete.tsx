"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

interface PlaceDetails {
  place_id: string;
  formatted_address: string;
  name: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  address_components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect: (place: PlaceDetails) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = "Enter address...",
  disabled = false,
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Fetch predictions from API
  const fetchPredictions = useCallback(async (input: string) => {
    if (!input || input.length < 3) {
      setPredictions([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/places/autocomplete?input=${encodeURIComponent(input)}`
      );
      if (response.ok) {
        const data = await response.json();
        setPredictions(data.predictions || []);
        setShowDropdown(true);
      }
    } catch (err) {
      console.error("Autocomplete error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced input handler
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setSelectedIndex(-1);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchPredictions(newValue);
    }, 300);
  };

  // Select a prediction
  const handleSelect = async (prediction: PlacePrediction) => {
    onChange(prediction.description);
    setShowDropdown(false);
    setPredictions([]);

    // Fetch place details
    try {
      const response = await fetch(
        `/api/places/details?place_id=${encodeURIComponent(prediction.place_id)}`
      );
      if (response.ok) {
        const data = await response.json();
        onPlaceSelect(data.place);
      }
    } catch (err) {
      console.error("Place details error:", err);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || predictions.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < predictions.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && predictions[selectedIndex]) {
          handleSelect(predictions[selectedIndex]);
        }
        break;
      case "Escape":
        setShowDropdown(false);
        break;
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => predictions.length > 0 && setShowDropdown(true)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ width: "100%" }}
        autoComplete="off"
      />

      {loading && (
        <div
          style={{
            position: "absolute",
            right: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: "0.75rem",
            color: "#6c757d",
          }}
        >
          ...
        </div>
      )}

      {showDropdown && predictions.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #dee2e6",
            borderRadius: "4px",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
            maxHeight: "300px",
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          {predictions.map((prediction, index) => (
            <div
              key={prediction.place_id}
              onClick={() => handleSelect(prediction)}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                background: index === selectedIndex ? "#f0f0f0" : "transparent",
                borderBottom:
                  index < predictions.length - 1 ? "1px solid #eee" : "none",
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div style={{ fontWeight: 500 }}>
                {prediction.structured_formatting.main_text}
              </div>
              <div style={{ fontSize: "0.875rem", color: "#6c757d" }}>
                {prediction.structured_formatting.secondary_text}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
