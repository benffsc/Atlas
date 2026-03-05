/**
 * Shared types for the intake form step components.
 * Extracted from intake/page.tsx for decomposition (FFS-113).
 */

import type { ResolvedPlace } from "@/hooks/usePlaceResolver";

// The form's CallType includes "" for unselected state
export type FormCallType =
  | ""
  | "pet_spay_neuter"
  | "wellness_check"
  | "single_stray"
  | "colony_tnr"
  | "kitten_rescue"
  | "medical_concern";

export type Step = "call_type" | "contact" | "location" | "cat_details" | "situation" | "review";

export interface CustomField {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  help_text: string | null;
  is_required: boolean;
  is_beacon_critical: boolean;
  display_order: number;
}

export interface PlaceDetails {
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

export interface PersonAddress {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  role: string;
  confidence: number | null;
}

export interface PersonSuggestion {
  person_id: string;
  display_name: string;
  emails: string | null;
  phones: string | null;
  cat_count: number;
  addresses: PersonAddress[] | null;
}

export interface FormData {
  // Call routing
  call_type: FormCallType;

  // Contact
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  requester_address: string;
  requester_city: string;
  requester_zip: string;

  // Third-party report
  is_third_party_report: boolean;
  third_party_relationship: string;
  property_owner_name: string;
  property_owner_phone: string;
  property_owner_email: string;

  // Location
  cats_address: string;
  cats_city: string;
  cats_zip: string;
  county: string;
  same_as_requester: boolean;

  // Cat details (varies by call type)
  cat_name: string;
  cat_description: string;
  cat_count: string;
  fixed_status: string;

  // Handleability
  handleability: string;

  // Colony-specific
  peak_count: string;
  eartip_count: string;
  feeding_situation: string;
  cats_needing_tnr: string;

  // Kitten-specific
  kitten_count: string;
  kitten_age: string;
  kitten_socialization: string;
  mom_present: string;

  // Medical
  has_medical_concerns: boolean;
  medical_description: string;
  is_emergency: boolean;
  emergency_acknowledged: boolean;

  // Property/Access
  is_property_owner: string;
  has_property_access: string;

  // Notes
  notes: string;
  referral_source: string;
}

export const initialFormData: FormData = {
  call_type: "",
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  requester_address: "",
  requester_city: "",
  requester_zip: "",
  is_third_party_report: false,
  third_party_relationship: "",
  property_owner_name: "",
  property_owner_phone: "",
  property_owner_email: "",
  cats_address: "",
  cats_city: "",
  cats_zip: "",
  county: "",
  same_as_requester: false,
  cat_name: "",
  cat_description: "",
  cat_count: "1",
  fixed_status: "",
  handleability: "",
  peak_count: "",
  eartip_count: "",
  feeding_situation: "",
  cats_needing_tnr: "",
  kitten_count: "",
  kitten_age: "",
  kitten_socialization: "",
  mom_present: "",
  has_medical_concerns: false,
  medical_description: "",
  is_emergency: false,
  emergency_acknowledged: false,
  is_property_owner: "",
  has_property_access: "",
  notes: "",
  referral_source: "",
};

// Common props shared by all step components
export interface BaseStepProps {
  formData: FormData;
  updateField: (field: keyof FormData, value: string | boolean) => void;
  errors: Record<string, string>;
}

// Step-specific props

export interface ContactStepProps extends BaseStepProps {
  handleContactFieldChange: (field: keyof FormData, value: string) => void;
  selectedPersonId: string | null;
  setSelectedPersonId: (id: string | null) => void;
  showPersonDropdown: boolean;
  personSuggestions: PersonSuggestion[];
  personSearchLoading: boolean;
  personDropdownRef: React.RefObject<HTMLDivElement>;
  selectPerson: (person: PersonSuggestion) => void;
}

export interface LocationStepProps extends BaseStepProps {
  showAddressSelection: boolean;
  personAddresses: PersonAddress[];
  selectedAddressId: string | null;
  handleKnownAddressSelect: (address: PersonAddress) => void;
  onSelectNewAddress: () => void;
  resolvedCatPlace: ResolvedPlace | null;
  handleCatPlaceResolved: (place: ResolvedPlace | null) => void;
  selectedPlaceId: string | null;
  catsAtMyAddress: boolean;
  setCatsAtMyAddress: (v: boolean) => void;
  resolvedRequesterPlace: ResolvedPlace | null;
  handleRequesterPlaceResolved: (place: ResolvedPlace | null) => void;
  selectedPersonId: string | null;
}

export interface CatDetailsStepProps extends BaseStepProps {
  customFields: CustomField[];
  customFieldValues: Record<string, string | boolean>;
  updateCustomField: (fieldKey: string, value: string | boolean) => void;
  setShowEmergencyModal: (show: boolean) => void;
}
