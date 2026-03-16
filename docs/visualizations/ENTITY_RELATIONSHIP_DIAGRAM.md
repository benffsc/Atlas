# Atlas Entity Relationship Diagram

High-resolution ERD showing all entities, relationships, and key columns.

## Core Entities (SOT Layer)

```mermaid
erDiagram
    %% ============================================================
    %% CORE ENTITIES - sot schema
    %% ============================================================

    sot.people {
        uuid person_id PK
        text display_name
        text account_type "resident|colony_caretaker|community_trapper|rescue_operator|organization"
        boolean is_canonical
        uuid merged_into_person_id FK "Self-referential merge chain"
        uuid primary_address_id FK
        text source_system "clinichq|volunteerhub|airtable|shelterluv|web_intake"
        text source_record_id
        timestamptz source_created_at
        timestamptz created_at
        timestamptz updated_at
    }

    sot.cats {
        uuid cat_id PK
        text display_name
        text sex "male|female|unknown"
        text altered_status "altered|intact|unknown"
        text breed
        text microchip "15-digit ISO standard"
        text clinichq_animal_id "ClinicHQ Number field"
        text shelterluv_animal_id
        text airtable_id
        uuid merged_into_cat_id FK "Self-referential merge chain"
        text source_system
        text source_record_id
        timestamptz created_at
        timestamptz updated_at
    }

    sot.places {
        uuid place_id PK
        text display_name
        text formatted_address
        text place_kind "residential_house|apartment_unit|business|clinic|outdoor_site"
        uuid sot_address_id FK "REQUIRED - MIG_2562"
        decimal latitude
        decimal longitude
        text locality "City name"
        text postal_code
        uuid merged_into_place_id FK "Self-referential merge chain"
        boolean requires_unit_selection "Multi-unit places"
        text source_system
        timestamptz created_at
    }

    sot.addresses {
        uuid address_id PK
        text formatted_address
        text street_number
        text route
        text locality
        text admin_area_1
        text postal_code
        text country
        decimal latitude
        decimal longitude
        text place_id_google "Google Places ID"
        timestamptz created_at
    }

    ops.requests ||--o| sot.places : "place_id"
    ops.requests ||--o| sot.people : "requester_person_id"
    ops.requests ||--o| sot.people : "assigned_to"

    ops.requests {
        uuid request_id PK
        text status "new|triaged|scheduled|in_progress|completed|cancelled|on_hold"
        text priority "urgent|high|normal|low"
        text summary
        int estimated_cat_count "Cats needing TNR"
        int total_cats_reported "Colony size"
        boolean has_kittens
        uuid place_id FK
        uuid requester_person_id FK
        uuid assigned_to FK
        timestamptz scheduled_date
        timestamptz resolved_at
        text source_system
        text source_record_id
        timestamptz source_created_at
        timestamptz created_at
    }

    %% ============================================================
    %% RELATIONSHIP TABLES - Junction tables
    %% ============================================================

    sot.person_cat {
        uuid person_cat_id PK
        uuid person_id FK
        uuid cat_id FK
        text relationship_type "owner|caretaker|feeder|foster|adopter"
        text evidence_type "source_record|inference|manual"
        decimal confidence
        timestamptz started_at
        timestamptz ended_at
        text source_system
    }

    sot.cat_place {
        uuid cat_place_id PK
        uuid cat_id FK
        uuid place_id FK
        text relationship_type "home|residence|colony_member|trapped_at|treated_at"
        text evidence_type "source_record|inference|manual"
        decimal confidence
        timestamptz first_seen
        timestamptz last_seen
        text source_system
    }

    sot.person_place {
        uuid person_place_id PK
        uuid person_id FK
        uuid place_id FK
        text relationship_type "owner|resident|landlord|caretaker|colony_caretaker"
        decimal confidence
        timestamptz started_at
        timestamptz ended_at
        text source_system
    }

    %% ============================================================
    %% IDENTITY LAYER
    %% ============================================================

    sot.person_identifiers {
        uuid identifier_id PK
        uuid person_id FK
        text identifier_type "email|phone|volunteerhub_id|clinichq_client_id"
        text identifier_value
        decimal confidence "PetLink emails < 0.5"
        boolean is_verified
        text source_system
        timestamptz created_at
    }

    sot.households {
        uuid household_id PK
        text name
        timestamptz created_at
    }

    sot.household_members {
        uuid member_id PK
        uuid household_id FK
        uuid person_id FK
        text role "head|spouse|child|other"
        timestamptz joined_at
    }

    %% ============================================================
    %% RELATIONSHIPS
    %% ============================================================

    sot.people ||--o{ sot.person_identifiers : "has"
    sot.people ||--o{ sot.person_cat : "owns/cares for"
    sot.people ||--o{ sot.person_place : "lives at/manages"
    sot.people ||--o| sot.addresses : "primary_address_id"

    sot.cats ||--o{ sot.person_cat : "owned by"
    sot.cats ||--o{ sot.cat_place : "lives at"

    sot.places ||--o{ sot.cat_place : "contains"
    sot.places ||--o{ sot.person_place : "occupied by"
    sot.places ||--o| sot.addresses : "sot_address_id"

    sot.household_members ||--o| sot.households : "belongs to"
    sot.household_members ||--o| sot.people : "is"
```

## Operational Layer (OPS Schema)

```mermaid
erDiagram
    %% ============================================================
    %% APPOINTMENTS & CLINIC DATA
    %% ============================================================

    ops.appointments {
        uuid appointment_id PK
        uuid cat_id FK
        uuid person_id FK "Resolved identity (may differ from booker)"
        uuid owner_account_id FK "Who booked (original)"
        uuid inferred_place_id FK "Where cat lives"
        date appointment_date
        text procedure_type
        text altered_status
        text client_name "Original ClinicHQ name"
        text source_system "clinichq"
        text source_record_id
        timestamptz created_at
    }

    ops.clinic_accounts {
        uuid account_id PK
        text original_name "Preserved exactly as in ClinicHQ"
        text name_classification "person|organization|site_name|address"
        text account_type "resident|colony_caretaker|community_trapper|organization"
        uuid resolved_person_id FK "Data Engine resolved identity"
        boolean is_pseudo_profile "Site names, addresses"
        text source_system
        timestamptz created_at
    }

    ops.file_uploads {
        uuid upload_id PK
        uuid batch_id
        text file_type "appointment_info|cat_info|owner_info"
        text file_hash
        int processing_order "1=appointment, 2=cat, 3=owner"
        boolean batch_ready
        text status "pending|processing|completed|failed"
        timestamptz created_at
    }

    ops.cat_test_results {
        uuid test_id PK
        uuid cat_id FK
        uuid appointment_id FK
        text test_type "felv|fiv|fvrcp|rabies"
        text result "positive|negative|inconclusive"
        text evidence_source
        decimal extraction_confidence
        text raw_text
        date test_date
        timestamptz created_at
    }

    %% ============================================================
    %% TRAPPER MANAGEMENT
    %% ============================================================

    sot.trapper_profiles {
        uuid trapper_id PK
        uuid person_id FK
        text trapper_type "ffsc_staff|ffsc_volunteer|community_trapper"
        text rescue_name "If runs a rescue"
        uuid rescue_place_id FK
        boolean has_signed_contract
        boolean is_legacy_informal
        int tier "1=FFSC, 2=Community, 3=Unofficial"
        timestamptz created_at
    }

    sot.trapper_service_places {
        uuid service_id PK
        uuid trapper_id FK
        uuid place_id FK
        text service_type "primary|backup|occasional"
        timestamptz started_at
        timestamptz ended_at
    }

    ops.trapper_contracts {
        uuid contract_id PK
        uuid person_id FK
        date signed_date
        text contract_type "community_trapper|ffsc_volunteer"
        text service_area_description
        boolean is_active
        timestamptz created_at
    }

    %% ============================================================
    %% ENTITY LINKING MONITORING
    %% ============================================================

    ops.entity_linking_runs {
        uuid run_id PK
        timestamptz started_at
        timestamptz completed_at
        int cats_linked
        int places_linked
        int people_linked
        int skipped_count
        text warnings
        text status "success|partial|failed"
    }

    ops.entity_linking_skipped {
        uuid skip_id PK
        uuid run_id FK
        text entity_type "cat|place|person"
        uuid entity_id
        text reason "no_place|clinic_fallback_blocked|no_identifier"
        jsonb details
        timestamptz created_at
    }

    %% ============================================================
    %% RELATIONSHIPS
    %% ============================================================

    ops.appointments ||--o| sot.cats : "cat_id"
    ops.appointments ||--o| sot.people : "person_id"
    ops.appointments ||--o| ops.clinic_accounts : "owner_account_id"
    ops.appointments ||--o| sot.places : "inferred_place_id"

    ops.clinic_accounts ||--o| sot.people : "resolved_person_id"

    ops.cat_test_results ||--o| sot.cats : "cat_id"
    ops.cat_test_results ||--o| ops.appointments : "appointment_id"

    sot.trapper_profiles ||--o| sot.people : "person_id"
    sot.trapper_profiles ||--o| sot.places : "rescue_place_id"
    sot.trapper_service_places ||--o| sot.trapper_profiles : "trapper_id"
    sot.trapper_service_places ||--o| sot.places : "place_id"

    ops.trapper_contracts ||--o| sot.people : "person_id"

    ops.entity_linking_skipped ||--o| ops.entity_linking_runs : "run_id"
```

## Source Layer (Staging)

```mermaid
erDiagram
    source.staged_records {
        uuid staged_record_id PK
        text source_system "clinichq|shelterluv|volunteerhub|airtable"
        text record_type "appointment|animal|person|request"
        jsonb payload "Raw data from source"
        text processing_status "pending|processed|failed|skipped"
        text processing_notes
        timestamptz source_created_at
        timestamptz processed_at
        timestamptz created_at
    }

    source.clinichq_raw {
        uuid raw_id PK
        uuid batch_id FK
        text file_type
        jsonb row_data
        int row_number
        timestamptz created_at
    }

    source.clinichq_raw ||--o| ops.file_uploads : "batch_id"
```

## Key Invariants

| Rule | Enforcement |
|------|-------------|
| **Merge chains** | `merged_into_*_id` - never hard delete |
| **Confidence filter** | `person_identifiers.confidence >= 0.5` for PetLink |
| **Address required** | `sot.places.sot_address_id` MUST be set (MIG_2562) |
| **Place is anchor** | Cat location via `inferred_place_id`, NOT person->place |
| **Single write path** | Use `find_or_create_*` functions only |
