# Atlas Data Flow Architecture

High-resolution diagram showing how data flows through the 3-layer architecture.

## System Overview

```mermaid
graph TB
    subgraph "External Systems"
        CHQ[ClinicHQ<br/>Clinic Management]
        VH[VolunteerHub<br/>Volunteer Management]
        SL[ShelterLuv<br/>Shelter Management]
        AT[Airtable<br/>Request Intake]
        WEB[Web Intake Form]
        PL[PetLink<br/>Microchip Registry]
    end

    subgraph "LAYER 1: SOURCE"
        STG[source.staged_records<br/>Raw payloads]
        CHQ_RAW[source.clinichq_raw<br/>ClinicHQ rows]
    end

    subgraph "LAYER 2: OPS"
        APPTS[ops.appointments<br/>Clinic visits]
        UPLOADS[ops.file_uploads<br/>Batch tracking]
        ACCOUNTS[ops.clinic_accounts<br/>ClinicHQ clients]
        TESTS[ops.cat_test_results<br/>FeLV/FIV tests]
        ROLES[ops.person_roles<br/>Volunteer roles]
        CONTRACTS[ops.trapper_contracts<br/>Community trapper contracts]
        EL_RUNS[ops.entity_linking_runs<br/>Linking history]
        EL_SKIP[ops.entity_linking_skipped<br/>Failed links]
    end

    subgraph "LAYER 3: SOT (Source of Truth)"
        CATS[sot.cats<br/>Canonical cats]
        PEOPLE[sot.people<br/>Canonical people]
        PLACES[sot.places<br/>Canonical places]
        REQUESTS[sot.requests<br/>TNR requests]
        ADDRESSES[sot.addresses<br/>Normalized addresses]
        IDENTIFIERS[sot.person_identifiers<br/>Email/phone]
        CAT_PLACE[sot.cat_place_relationships<br/>Where cats live]
        PERSON_PLACE[sot.person_place_relationships<br/>Where people live]
        PERSON_CAT[sot.person_cat_relationships<br/>Cat ownership]
        TRAPPERS[sot.trapper_profiles<br/>Trapper info]
    end

    subgraph "ANALYTICS: BEACON"
        BEACON_SUMMARY[ops.v_beacon_summary<br/>Colony metrics]
        CLUSTERS[ops.mv_beacon_clusters<br/>Geographic clusters]
        DISEASE[ops.v_place_disease_status<br/>FeLV/FIV rates]
    end

    %% Source System Flows
    CHQ -->|Batch Upload| CHQ_RAW
    VH -->|Webhook| STG
    SL -->|Webhook| STG
    AT -->|Webhook| STG
    WEB -->|Form Submit| STG
    PL -->|Import| CATS

    %% Processing Flows
    CHQ_RAW -->|"ops.process_clinichq_*()"| APPTS
    CHQ_RAW -->|"ops.upsert_clinic_account_for_owner()"| ACCOUNTS
    STG -->|"Process staged records"| APPTS
    STG -->|"Process staged records"| ROLES

    %% Entity Creation
    APPTS -->|"sot.find_or_create_cat_by_*()"| CATS
    ACCOUNTS -->|"sot.data_engine_resolve_identity()"| PEOPLE
    ACCOUNTS -->|"sot.find_or_create_place_deduped()"| PLACES

    %% Entity Linking
    APPTS -->|"sot.link_appointments_to_places()"| CAT_PLACE
    CATS -->|"sot.link_cats_to_places()"| CAT_PLACE
    PEOPLE -->|"sot.link_person_to_place()"| PERSON_PLACE
    PEOPLE -->|"sot.link_person_to_cat()"| PERSON_CAT

    %% Beacon Analytics
    CAT_PLACE --> BEACON_SUMMARY
    TESTS --> DISEASE
    PLACES --> CLUSTERS
```

## ClinicHQ Batch Processing Flow

The most complex data flow - processing clinic appointment data:

```mermaid
sequenceDiagram
    participant Staff as Staff Upload
    participant API as /api/v2/ingest/clinichq
    participant FU as ops.file_uploads
    participant RAW as source.clinichq_raw
    participant P1 as Step 1: appointment_info
    participant P2 as Step 2: cat_info
    participant P3 as Step 3: owner_info
    participant APPTS as ops.appointments
    participant CATS as sot.cats
    participant PEOPLE as sot.people
    participant PLACES as sot.places
    participant ACCOUNTS as ops.clinic_accounts

    Staff->>API: Upload 3 CSV files
    API->>FU: Create batch_id, set processing_order
    API->>RAW: Store raw rows

    Note over P1,APPTS: ORDER MATTERS - MIG_2400

    rect rgb(200, 230, 200)
        Note over P1: Step 1: appointment_info (order=1)
        P1->>P1: ops.process_clinichq_appointments()
        P1->>APPTS: Create appointment records
        P1->>P1: Extract procedure types
    end

    rect rgb(200, 220, 240)
        Note over P2: Step 2: cat_info (order=2)
        P2->>P2: ops.process_clinichq_cat_info()
        P2->>P2: Check for microchip
        alt Has Microchip
            P2->>CATS: sot.find_or_create_cat_by_microchip()
        else No Microchip
            P2->>CATS: sot.find_or_create_cat_by_clinichq_id()
        end
        P2->>APPTS: Link cat_id to appointment
    end

    rect rgb(240, 220, 200)
        Note over P3: Step 3: owner_info (order=3)
        P3->>P3: ops.process_clinichq_owner_info()
        P3->>P3: sot.classify_owner_name()

        alt Name = Person
            P3->>P3: sot.should_be_person() = TRUE
            P3->>ACCOUNTS: Create account (original name)
            P3->>P3: sot.data_engine_resolve_identity()
            P3->>PEOPLE: Create/find person
            P3->>ACCOUNTS: Set resolved_person_id
        else Name = Site/Address/Org
            P3->>P3: sot.should_be_person() = FALSE
            P3->>ACCOUNTS: Create pseudo-profile account
            Note over ACCOUNTS: resolved_person_id = NULL
        end

        P3->>PLACES: sot.find_or_create_place_deduped()
        P3->>APPTS: Set inferred_place_id
        P3->>APPTS: Set owner_account_id
    end
```

## Entity Linking Pipeline

```mermaid
flowchart TD
    subgraph "Orchestrator: sot.run_all_entity_linking()"
        PREFLIGHT[ops.preflight_entity_linking<br/>Verify functions exist]
        LINK_APPT_PLACE[sot.link_appointments_to_places<br/>Set inferred_place_id]
        LINK_CAT_PLACE[sot.link_cats_to_places<br/>Via appointment place]
        LINK_APPT_REQ[ops.link_appointments_to_requests<br/>Attribution window]
        LOG_RUN[ops.entity_linking_runs<br/>Record metrics]
    end

    PREFLIGHT -->|Pass| LINK_APPT_PLACE
    PREFLIGHT -->|Fail| ABORT[Abort with error]

    LINK_APPT_PLACE --> LINK_CAT_PLACE
    LINK_CAT_PLACE --> LINK_APPT_REQ
    LINK_APPT_REQ --> LOG_RUN

    subgraph "Linking Rules"
        R1[NO clinic address fallback<br/>MIG_2430]
        R2[Use inferred_place_id ONLY]
        R3[Skip if no place → log to entity_linking_skipped]
        R4[Attribution window: -6mo to +3mo]
    end

    LINK_CAT_PLACE -.->|Rules| R1
    LINK_CAT_PLACE -.->|Rules| R2
    LINK_CAT_PLACE -.->|Rules| R3
    LINK_APPT_REQ -.->|Rules| R4
```

## Identity Resolution Flow

```mermaid
flowchart TD
    INPUT[Input: email, phone, name]

    INPUT --> CLASSIFY[sot.classify_owner_name]
    CLASSIFY --> CLASS_RESULT{Classification?}

    CLASS_RESULT -->|person| SBP[sot.should_be_person]
    CLASS_RESULT -->|organization| PSEUDO[Create pseudo-profile<br/>ops.clinic_accounts]
    CLASS_RESULT -->|site_name| PSEUDO
    CLASS_RESULT -->|address| PSEUDO

    SBP --> SBP_RESULT{Should be person?}
    SBP_RESULT -->|FALSE| PSEUDO
    SBP_RESULT -->|TRUE| DERI[sot.data_engine_resolve_identity]

    DERI --> MATCH_EMAIL{Email match?<br/>confidence >= 0.5}
    MATCH_EMAIL -->|Yes| RETURN_PERSON[Return existing person_id]
    MATCH_EMAIL -->|No| MATCH_PHONE{Phone match?}

    MATCH_PHONE -->|No| CREATE_PERSON[Create new person]
    MATCH_PHONE -->|Yes| ADDR_CHECK{Address similar?<br/>similarity > 0.5}

    ADDR_CHECK -->|Yes| RETURN_PERSON
    ADDR_CHECK -->|No or Unknown| CREATE_PERSON

    CREATE_PERSON --> ADD_IDENT[Add to person_identifiers]
    RETURN_PERSON --> LINK_ACCOUNT[Link to clinic_account.resolved_person_id]
    ADD_IDENT --> LINK_ACCOUNT

    subgraph "Identity Rules"
        IR1[Never match by name only - INV-5]
        IR2[PetLink emails require confidence >= 0.5]
        IR3[Phone match requires address check - MIG_2548]
        IR4[Soft blacklist for org emails]
    end
```

## Request Lifecycle

```mermaid
stateDiagram-v2
    [*] --> new: Web intake / Airtable submission
    new --> triaged: Staff reviews
    triaged --> scheduled: Trapper assigned + date set
    triaged --> on_hold: Blocking issue
    scheduled --> in_progress: Trapping begins
    on_hold --> triaged: Issue resolved
    in_progress --> completed: All cats TNR'd
    in_progress --> on_hold: Issue arises
    completed --> [*]

    note right of new
        source_system = airtable|web_intake
        source_record_id = Airtable record ID
        source_created_at = original submission time
    end note

    note right of completed
        resolved_at = NOW()
        cats_trapped = count
        cats_returned = count
    end note
```

## Cat-Request Attribution

```mermaid
flowchart LR
    subgraph "Request Timeline"
        REQ_CREATE[Request Created<br/>source_created_at]
        REQ_RESOLVE[Request Resolved<br/>resolved_at]
    end

    subgraph "Attribution Window"
        W1[6 months BEFORE]
        W2[DURING request]
        W3[3 months AFTER]
    end

    subgraph "Matching Logic"
        APPT[Appointment<br/>appointment_date]
        CAT[Cat record]
        PLACE[Place match<br/>inferred_place_id]
    end

    REQ_CREATE --> W1
    REQ_CREATE --> W2
    REQ_RESOLVE --> W3

    W1 --> APPT
    W2 --> APPT
    W3 --> APPT

    APPT --> PLACE
    PLACE -->|Same place| LINK[Link cat to request]

    Note: Uses COALESCE(source_created_at, created_at) for legacy Airtable dates
```

## Disease Computation Flow

```mermaid
flowchart TD
    PLACE[Place ID]

    PLACE --> GATE[sot.should_compute_disease_for_place]
    GATE --> GATE_RESULT{Passes gate?}

    GATE_RESULT -->|No - Clinic| SKIP1[Skip: clinic address]
    GATE_RESULT -->|No - Blacklist| SKIP2[Skip: in place_soft_blacklist]
    GATE_RESULT -->|Yes| FILTER_RELS[Filter relationships]

    FILTER_RELS --> ONLY_RESIDENT{relationship_type in<br/>home, residence, colony_member?}

    ONLY_RESIDENT -->|No| SKIP3[Skip: transient relationship]
    ONLY_RESIDENT -->|Yes| GET_TESTS[Get cat test results]

    GET_TESTS --> COMPUTE[Compute disease rates<br/>FeLV positive / total<br/>FIV positive / total]

    COMPUTE --> STORE[Store in ops.v_place_disease_status]

    subgraph "Exclusions"
        EX1[845 Todd Rd - FFSC clinic]
        EX2[Empire Industrial Park]
        EX3[Shelter addresses]
        EX4[trapped_at relationships]
        EX5[treated_at relationships]
    end
```

## Data Quality Pipeline

```mermaid
flowchart LR
    subgraph "Audit Scripts"
        AUDIT[scripts/pipeline/run_audit.sh]
        FULL[scripts/pipeline/run_full_reprocess.sh]
    end

    subgraph "Quality Functions"
        SNAP[ops.take_quality_snapshot]
        HEALTH[ops.check_entity_linking_health]
        PREFLIGHT[ops.preflight_entity_linking]
    end

    subgraph "Monitoring Views"
        V1[ops.v_unhandled_recheck_duplicates]
        V2[ops.v_clinic_leakage]
        V3[ops.v_entity_linking_skipped_summary]
        V4[ops.v_cat_place_coverage]
    end

    subgraph "Expected State"
        E1[Recheck duplicates = 0]
        E2[Clinic leakage = 0]
        E3[Cat-place coverage > 80%]
    end

    AUDIT --> SNAP
    AUDIT --> HEALTH
    FULL --> PREFLIGHT
    FULL --> HEALTH

    HEALTH --> V1
    HEALTH --> V2
    HEALTH --> V3
    HEALTH --> V4

    V1 --> E1
    V2 --> E2
    V4 --> E3
```

## Merge Chain (No Data Disappears)

```mermaid
flowchart LR
    subgraph "Before Merge"
        L1[Person A<br/>id: abc-123]
        W1[Person B<br/>id: def-456]
    end

    subgraph "After Merge"
        L2[Person A<br/>id: abc-123<br/>merged_into_person_id: def-456]
        W2[Person B<br/>id: def-456<br/>merged_into_person_id: NULL]
    end

    subgraph "Query Filter"
        Q1["WHERE merged_into_person_id IS NULL"]
    end

    L1 -->|sot.merge_person_into| L2
    W1 -->|Unchanged| W2

    W2 --> Q1
    L2 -.->|Filtered out| Q1

    Note: All FKs pointing to Person A are updated to Person B
```

## Three-Tier Trapper Authority

```mermaid
flowchart TD
    subgraph "Tier 1: FFSC Trappers"
        T1_SOURCE[VolunteerHub ONLY]
        T1_GROUP["Approved Trappers" group]
        T1_REP[Represents FFSC: YES]
    end

    subgraph "Tier 2: Community Trappers"
        T2_SOURCE[Airtable ONLY]
        T2_CONTRACT[Signed trapper contract]
        T2_REP[Represents FFSC: NO<br/>Limited to specific areas]
    end

    subgraph "Tier 3: Unofficial Trappers"
        T3_SOURCE[Data patterns]
        T3_DETECT[sot.detect_unofficial_trappers]
        T3_REP[Represents FFSC: NO<br/>Historical/informal]
    end

    T1_SOURCE --> T1_GROUP
    T1_GROUP --> T1_REP

    T2_SOURCE --> T2_CONTRACT
    T2_CONTRACT --> T2_REP

    T3_SOURCE --> T3_DETECT
    T3_DETECT --> T3_REP

    subgraph "Database Tables"
        TP[sot.trapper_profiles]
        TC[ops.trapper_contracts]
        TSP[sot.trapper_service_places]
    end
```

## Key Data Flow Rules

| Rule | Enforcement |
|------|-------------|
| **Processing Order** | appointment_info → cat_info → owner_info (MIG_2400) |
| **No Clinic Fallback** | Skip cat if no inferred_place_id (MIG_2430) |
| **Confidence Filter** | PetLink emails require >= 0.5 |
| **Phone + Address** | Phone match requires address similarity check |
| **Place Links to Address** | Every place MUST have sot_address_id (MIG_2562) |
| **Attribution Window** | -6 months to +3 months around request lifecycle |
| **Merge Chains** | Never hard delete, set merged_into_*_id |
