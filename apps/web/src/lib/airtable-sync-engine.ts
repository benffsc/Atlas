/**
 * Airtable Sync Engine (FFS-504)
 *
 * Config-driven engine that reads sync definitions from ops.airtable_sync_configs
 * and executes them. New syncs require only a DB row — no code changes.
 *
 * Pipelines:
 *   person_onboarding — Resolve identity → add role → upsert profile → audit trail
 *   data_import       — Direct INSERT into target table (skeleton, not yet implemented)
 *   custom            — Skipped by engine (legacy routes handle these)
 */

import { queryOne, queryRows, query } from "@/lib/db";

// ============================================================================
// Types
// ============================================================================

/** Airtable field → mapped field definition */
export interface FieldMapping {
  maps_to: string;
  required?: boolean;
  transform?: "trim" | "lowercase_trim" | "boolean" | "date_today_if_truthy" | "json" | "number";
  default_value?: unknown;
}

/** How to write results back to Airtable */
export interface WritebackConfig {
  status_field: string;
  error_field: string;
  entity_id_field: string;
  synced_at_field: string;
  success_status: string;
  error_status: string;
}

/** Validation rule for a mapped field */
interface ValidationRule {
  required?: boolean;
  must_contain?: string;
}

/** Post-processing step: add a role to the person */
interface AddRoleStep {
  type: "add_role";
  role: string;
  source_system: string;
}

/** Post-processing step: upsert a profile row */
interface UpsertProfileStep {
  type: "upsert_profile";
  table: string;
  conflict_column: string;
  columns: Record<string, unknown>;
  on_conflict_update: Record<string, string>;
}

/** Post-processing step: insert audit trail */
interface AuditTrailStep {
  type: "audit_trail";
  entity_type: string;
  edit_type: string;
  field_name: string;
  edit_source: string;
  reason: string;
  new_value_fields: string[];
}

/** Post-processing step: run raw SQL */
interface SqlStep {
  type: "sql";
  query: string;
  params: string[];
}

export type PostStep = AddRoleStep | UpsertProfileStep | AuditTrailStep | SqlStep;

/** Pipeline config for person_onboarding */
export interface PersonOnboardingConfig {
  source_system: string;
  identity_fields: {
    email: string;
    phone: string;
    first_name: string;
    last_name: string;
    address: string;
  };
  validation_rules?: Record<string, ValidationRule>;
  post_steps: PostStep[];
  entity_id_type: string;
}

/** Full sync config as stored in DB */
export interface SyncConfig {
  config_id: string;
  name: string;
  description: string | null;
  airtable_base_id: string;
  airtable_table_name: string;
  filter_formula: string;
  page_size: number;
  field_mappings: Record<string, FieldMapping>;
  pipeline: "person_onboarding" | "data_import" | "custom";
  pipeline_config: PersonOnboardingConfig | Record<string, unknown>;
  writeback_config: WritebackConfig;
  schedule_cron: string | null;
  is_active: boolean;
  is_legacy: boolean;
  max_records_per_run: number;
  max_duration_seconds: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_count: number;
}

/** Raw Airtable record */
interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

/** Result of processing a single record */
export interface RecordResult {
  success: boolean;
  recordId: string;
  entityId?: string;
  matchType?: string;
  error?: string;
  /** 'synced' | 'rejected' | 'error' — for audit trail */
  auditStatus?: "synced" | "rejected" | "error";
  /** Why identity resolution rejected this record */
  rejectionReason?: string;
  /** Full identity resolution response (always logged when called) */
  identityResult?: Record<string, unknown>;
}

/** Result of an entire sync run */
export interface SyncRunResult {
  configName: string;
  triggerType: string;
  recordsFound: number;
  recordsSynced: number;
  recordsErrored: number;
  durationMs: number;
  results: RecordResult[];
  error?: string;
}

// ============================================================================
// Transforms
// ============================================================================

const TRANSFORMS: Record<string, (v: unknown) => unknown> = {
  trim: (v) => (typeof v === "string" ? v.trim() : v),

  lowercase_trim: (v) =>
    typeof v === "string" ? v.trim().toLowerCase() : v,

  boolean: (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const lower = v.toLowerCase();
      return lower === "yes" || lower === "true" || lower === "1" || lower === "checked";
    }
    // Non-empty arrays (e.g. Airtable attachment fields like Signature) are truthy
    if (Array.isArray(v)) return v.length > 0;
    return !!v;
  },

  date_today_if_truthy: (v) => {
    const isTruthy = TRANSFORMS.boolean(v);
    return isTruthy ? new Date().toISOString().slice(0, 10) : null;
  },

  json: (v) => JSON.stringify(v),

  number: (v) => {
    const n = parseFloat(String(v));
    return isNaN(n) ? null : n;
  },
};

// ============================================================================
// Engine
// ============================================================================

export class AirtableSyncEngine {
  private pat: string;

  constructor() {
    const pat = process.env.AIRTABLE_PAT;
    if (!pat) {
      throw new Error("AIRTABLE_PAT environment variable is not configured");
    }
    this.pat = pat;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /** Run a sync by config UUID */
  async runSync(
    configId: string,
    triggerType: "cron" | "webhook" | "manual"
  ): Promise<SyncRunResult> {
    const config = await this.fetchConfig({ config_id: configId });
    return this.executeSync(config, triggerType);
  }

  /** Run a sync by config name slug */
  async runSyncByName(
    name: string,
    triggerType: "cron" | "webhook" | "manual"
  ): Promise<SyncRunResult> {
    const config = await this.fetchConfig({ name });
    return this.executeSync(config, triggerType);
  }

  // --------------------------------------------------------------------------
  // Core flow
  // --------------------------------------------------------------------------

  private async executeSync(
    config: SyncConfig,
    triggerType: "cron" | "webhook" | "manual"
  ): Promise<SyncRunResult> {
    const startTime = Date.now();
    const results: RecordResult[] = [];

    // Skip legacy/custom configs — they exist for registry only
    if (config.pipeline === "custom" || config.is_legacy) {
      const result: SyncRunResult = {
        configName: config.name,
        triggerType,
        recordsFound: 0,
        recordsSynced: 0,
        recordsErrored: 0,
        durationMs: Date.now() - startTime,
        results: [],
        error: `Config "${config.name}" uses pipeline "${config.pipeline}" (is_legacy=${config.is_legacy}) — skipped by engine`,
      };
      await this.logRun(config, triggerType, result);
      return result;
    }

    if (!config.is_active) {
      const result: SyncRunResult = {
        configName: config.name,
        triggerType,
        recordsFound: 0,
        recordsSynced: 0,
        recordsErrored: 0,
        durationMs: Date.now() - startTime,
        results: [],
        error: `Config "${config.name}" is inactive — skipped`,
      };
      await this.logRun(config, triggerType, result);
      return result;
    }

    // Create the run row upfront so per-record logs reference it
    const runId = await this.createRun(config, triggerType);

    try {
      // 1. Poll Airtable
      const records = await this.pollRecords(config);
      const toProcess = records.slice(0, config.max_records_per_run);

      // 2. Claim: immediately mark all records as "processing" to prevent
      //    duplicate processing from overlapping webhook/cron calls.
      //    The filter formula excludes "processing", so a second call
      //    that arrives while we're working won't re-fetch these records.
      await this.claimRecords(config, toProcess);

      // 3. Process each record sequentially
      for (const record of toProcess) {
        const mapped = this.mapRecord(record, config.field_mappings);
        let recordResult: RecordResult;

        try {
          // Validate
          const validationError = this.validateFields(
            mapped,
            config.pipeline_config as PersonOnboardingConfig
          );
          if (validationError) {
            recordResult = {
              success: false,
              recordId: record.id,
              error: validationError,
              auditStatus: "rejected",
              rejectionReason: validationError,
            };
          } else {
            // Execute pipeline
            recordResult = await this.executePipeline(
              config.pipeline,
              config.pipeline_config as PersonOnboardingConfig,
              mapped,
              record
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[SYNC-ENGINE] Error for record ${record.id}:`, msg);
          recordResult = {
            success: false,
            recordId: record.id,
            error: `Sync failed: ${msg}`,
            auditStatus: "error",
          };
        }

        results.push(recordResult);

        // 4. Log to audit trail (every record, regardless of outcome)
        await this.logRecord(config, record, mapped, recordResult, runId);

        // 5. Writeback to Airtable (overwrites "processing" with final status)
        await this.writebackRecord(
          config,
          record.id,
          recordResult
        );
      }

      const syncResult: SyncRunResult = {
        configName: config.name,
        triggerType,
        recordsFound: records.length,
        recordsSynced: results.filter((r) => r.success).length,
        recordsErrored: results.filter((r) => !r.success).length,
        durationMs: Date.now() - startTime,
        results,
      };

      // 6. Complete run + update config tracking
      await this.completeRun(runId, syncResult);
      await this.updateConfigLastSync(config, syncResult);

      return syncResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SYNC-ENGINE] Fatal error for "${config.name}":`, msg);

      const syncResult: SyncRunResult = {
        configName: config.name,
        triggerType,
        recordsFound: 0,
        recordsSynced: 0,
        recordsErrored: 0,
        durationMs: Date.now() - startTime,
        results,
        error: msg,
      };

      await this.completeRun(runId, syncResult);
      await this.updateConfigLastSync(config, syncResult);

      return syncResult;
    }
  }

  // --------------------------------------------------------------------------
  // Config loading
  // --------------------------------------------------------------------------

  private async fetchConfig(
    where: { config_id: string } | { name: string }
  ): Promise<SyncConfig> {
    let row: SyncConfig | null;

    if ("config_id" in where) {
      row = await queryOne<SyncConfig>(
        `SELECT * FROM ops.airtable_sync_configs WHERE config_id = $1`,
        [where.config_id]
      );
    } else {
      row = await queryOne<SyncConfig>(
        `SELECT * FROM ops.airtable_sync_configs WHERE name = $1`,
        [where.name]
      );
    }

    if (!row) {
      const key = "config_id" in where ? where.config_id : where.name;
      throw new Error(`Sync config not found: ${key}`);
    }

    return row;
  }

  // --------------------------------------------------------------------------
  // Airtable API
  // --------------------------------------------------------------------------

  private async airtableFetch(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = endpoint.startsWith("http")
      ? endpoint
      : `https://api.airtable.com/v0${endpoint}`;

    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.pat}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  }

  private async pollRecords(config: SyncConfig): Promise<AirtableRecord[]> {
    const records: AirtableRecord[] = [];
    let offset: string | undefined;

    do {
      const url = new URL(
        `https://api.airtable.com/v0/${config.airtable_base_id}/${encodeURIComponent(config.airtable_table_name)}`
      );
      url.searchParams.set("filterByFormula", config.filter_formula);
      url.searchParams.set("pageSize", String(config.page_size));
      if (offset) url.searchParams.set("offset", offset);

      const res = await this.airtableFetch(url.toString());
      const data = await res.json();

      if (data.error) {
        console.error(`[SYNC-ENGINE] Airtable API error for "${config.name}":`, data.error);
        break;
      }

      records.push(...(data.records || []));
      offset = data.offset;
    } while (offset);

    console.error(`[SYNC-ENGINE] "${config.name}": found ${records.length} records`);
    return records;
  }

  /**
   * Claim records by immediately setting Sync Status to "processing".
   * This prevents duplicate processing when overlapping webhook/cron calls
   * both poll Airtable before either finishes. The filter formula only
   * matches pending/error/blank — NOT "processing" — so a second call
   * arriving while we work won't re-fetch these records.
   *
   * Uses Airtable batch update (up to 10 records per request).
   */
  private async claimRecords(
    config: SyncConfig,
    records: AirtableRecord[]
  ): Promise<void> {
    if (records.length === 0) return;

    const wb = config.writeback_config;
    const batchSize = 10; // Airtable batch limit

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      try {
        await this.airtableFetch(
          `/${config.airtable_base_id}/${encodeURIComponent(config.airtable_table_name)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              records: batch.map((r) => ({
                id: r.id,
                fields: { [wb.status_field]: "processing" },
              })),
            }),
          }
        );
      } catch (err) {
        console.error(`[SYNC-ENGINE] Failed to claim batch:`, err);
        // Continue anyway — worst case is a duplicate, not a failure
      }
    }

    console.error(`[SYNC-ENGINE] "${config.name}": claimed ${records.length} records as processing`);
  }

  private async writebackRecord(
    config: SyncConfig,
    recordId: string,
    result: RecordResult
  ): Promise<void> {
    const wb = config.writeback_config;
    const fields: Record<string, unknown> = {};

    if (result.success) {
      fields[wb.status_field] = wb.success_status;
      fields[wb.synced_at_field] = new Date().toISOString();
      fields[wb.error_field] = null;
      if (result.entityId) {
        fields[wb.entity_id_field] = result.entityId;
      }
    } else {
      fields[wb.status_field] = wb.error_status;
      fields[wb.synced_at_field] = new Date().toISOString();
      fields[wb.error_field] = result.error;
    }

    try {
      await this.airtableFetch(
        `/${config.airtable_base_id}/${encodeURIComponent(config.airtable_table_name)}/${recordId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ fields }),
        }
      );
    } catch (err) {
      console.error(`[SYNC-ENGINE] Writeback failed for record ${recordId}:`, err);
    }
  }

  // --------------------------------------------------------------------------
  // Field mapping
  // --------------------------------------------------------------------------

  private mapRecord(
    record: AirtableRecord,
    mappings: Record<string, FieldMapping>
  ): Record<string, unknown> {
    const mapped: Record<string, unknown> = {
      _airtable_record_id: record.id,
    };

    for (const [airtableField, mapping] of Object.entries(mappings)) {
      let value = record.fields[airtableField];

      // Apply transform
      if (mapping.transform && value != null) {
        const fn = TRANSFORMS[mapping.transform];
        if (fn) value = fn(value);
      }

      // Apply default
      if (value == null && mapping.default_value !== undefined) {
        value = mapping.default_value;
      }

      mapped[mapping.maps_to] = value ?? null;
    }

    return mapped;
  }

  // --------------------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------------------

  private validateFields(
    mapped: Record<string, unknown>,
    pipelineConfig: PersonOnboardingConfig
  ): string | null {
    const rules = pipelineConfig.validation_rules;
    if (!rules) return null;

    for (const [field, rule] of Object.entries(rules)) {
      const value = mapped[field];

      if (rule.required && !value) {
        return `Missing required field: ${field}`;
      }

      if (rule.must_contain && typeof value === "string" && !value.includes(rule.must_contain)) {
        return `Invalid ${field}: must contain "${rule.must_contain}"`;
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Pipeline dispatch
  // --------------------------------------------------------------------------

  private async executePipeline(
    pipeline: string,
    config: PersonOnboardingConfig,
    mapped: Record<string, unknown>,
    record: AirtableRecord
  ): Promise<RecordResult> {
    switch (pipeline) {
      case "person_onboarding":
        return this.personOnboardingPipeline(config, mapped, record);
      case "data_import":
        throw new Error("data_import pipeline is not yet implemented");
      default:
        throw new Error(`Unknown pipeline: ${pipeline}`);
    }
  }

  // --------------------------------------------------------------------------
  // Pipeline: person_onboarding
  // --------------------------------------------------------------------------

  private async personOnboardingPipeline(
    config: PersonOnboardingConfig,
    mapped: Record<string, unknown>,
    record: AirtableRecord
  ): Promise<RecordResult> {
    const idf = config.identity_fields;

    // Validate required identity fields
    const firstName = mapped[idf.first_name] as string | null;
    const lastName = mapped[idf.last_name] as string | null;
    const email = mapped[idf.email] as string | null;
    const phone = mapped[idf.phone] as string | null;
    const address = mapped[idf.address] as string | null;

    if (!firstName || !lastName) {
      return {
        success: false,
        recordId: record.id,
        error: "Missing required fields: first_name and last_name",
        auditStatus: "rejected",
        rejectionReason: "Missing required fields: first_name and last_name",
      };
    }

    if (!email || !email.includes("@")) {
      return {
        success: false,
        recordId: record.id,
        error: "Missing or invalid email address",
        auditStatus: "rejected",
        rejectionReason: "Missing or invalid email address",
      };
    }

    // Step 1: Resolve identity
    // data_engine_resolve_identity returns: resolved_person_id, decision_type,
    // display_name, confidence, reason, match_details, decision_id
    const identityResult = await queryOne<{
      resolved_person_id: string | null;
      decision_type: string;
      reason: string | null;
    }>(
      `SELECT * FROM sot.data_engine_resolve_identity($1, $2, $3, $4, $5, $6)`,
      [email, phone || null, firstName, lastName, address || null, config.source_system]
    );

    if (!identityResult) {
      return {
        success: false,
        recordId: record.id,
        error: "Identity resolution returned no result",
        auditStatus: "error",
        rejectionReason: "Identity resolution returned no result",
      };
    }

    if (identityResult.decision_type === "rejected" || !identityResult.resolved_person_id) {
      return {
        success: false,
        recordId: record.id,
        error: `Identity resolution rejected: ${identityResult.reason || "no person_id returned"}`,
        auditStatus: "rejected",
        rejectionReason: identityResult.reason || "no person_id returned",
        identityResult: identityResult as unknown as Record<string, unknown>,
      };
    }

    const personId = identityResult.resolved_person_id;
    const matchType = identityResult.decision_type;

    // Step 2: Execute post_steps in order
    for (const step of config.post_steps) {
      await this.executePostStep(step, personId, mapped, record, matchType);
    }

    return {
      success: true,
      recordId: record.id,
      entityId: personId,
      matchType,
      auditStatus: "synced",
      identityResult: identityResult as unknown as Record<string, unknown>,
    };
  }

  // --------------------------------------------------------------------------
  // Post-step execution
  // --------------------------------------------------------------------------

  private async executePostStep(
    step: PostStep,
    personId: string,
    mapped: Record<string, unknown>,
    record: AirtableRecord,
    matchType: string
  ): Promise<void> {
    switch (step.type) {
      case "add_role":
        await this.executeAddRole(step, personId);
        break;
      case "upsert_profile":
        await this.executeUpsertProfile(step, personId, mapped);
        break;
      case "audit_trail":
        await this.executeAuditTrail(step, personId, mapped, record, matchType);
        break;
      case "sql":
        await this.executeSqlStep(step, personId, mapped);
        break;
    }
  }

  private async executeAddRole(step: AddRoleStep, personId: string): Promise<void> {
    await queryOne(
      `INSERT INTO sot.person_roles (person_id, role, source_system)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING person_id`,
      [personId, step.role, step.source_system]
    );
  }

  private async executeUpsertProfile(
    step: UpsertProfileStep,
    personId: string,
    mapped: Record<string, unknown>
  ): Promise<void> {
    // Resolve column values from config + mapped data
    const columns: string[] = [];
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const [col, spec] of Object.entries(step.columns)) {
      columns.push(col);

      if (typeof spec === "string" && spec === "$person_id") {
        placeholders.push(`$${paramIdx}`);
        values.push(personId);
      } else if (typeof spec === "string" && spec.startsWith("$")) {
        // Reference to a mapped field
        const fieldName = spec.slice(1);
        placeholders.push(`$${paramIdx}`);
        values.push(mapped[fieldName] ?? null);
      } else if (spec !== null && typeof spec === "object" && "transform" in spec) {
        // Apply a transform to a mapped field
        const obj = spec as { transform: string; source: string };
        const rawValue = mapped[obj.source];
        const fn = TRANSFORMS[obj.transform];
        placeholders.push(`$${paramIdx}`);
        values.push(fn ? fn(rawValue) : rawValue);
      } else if (spec !== null && typeof spec === "object" && "template" in spec) {
        // Template string with ${field} interpolation
        const template = (spec as { template: string }).template;
        const resolved = template.replace(/\$\{(\w+)\}/g, (_, field) => {
          const val = mapped[field];
          return val != null ? String(val) : "";
        });
        placeholders.push(`$${paramIdx}`);
        // If template resolves to empty string or just label text with no value, use null
        const trimmed = resolved.trim();
        const isEmpty = !trimmed || /^\w+:\s*$/.test(trimmed);
        values.push(isEmpty ? null : resolved);
      } else {
        // Literal value
        placeholders.push(`$${paramIdx}`);
        values.push(spec);
      }

      paramIdx++;
    }

    // Build ON CONFLICT SET clause using raw SQL expressions from config
    const updateParts: string[] = [];
    for (const [col, expr] of Object.entries(step.on_conflict_update)) {
      updateParts.push(`${col} = ${expr}`);
    }

    const sql = `
      INSERT INTO ${step.table} (${columns.join(", ")})
      VALUES (${placeholders.join(", ")})
      ON CONFLICT (${step.conflict_column}) DO UPDATE SET
        ${updateParts.join(",\n        ")}
      RETURNING ${step.conflict_column}`;

    await queryOne(sql, values);
  }

  private async executeAuditTrail(
    step: AuditTrailStep,
    personId: string,
    mapped: Record<string, unknown>,
    record: AirtableRecord,
    matchType: string
  ): Promise<void> {
    // Build the new_value JSONB from configured fields + standard metadata
    const newValueObj: Record<string, unknown> = {
      airtable_record_id: record.id,
      match_type: matchType,
    };
    for (const field of step.new_value_fields) {
      newValueObj[field] = mapped[field] ?? null;
    }

    await queryOne(
      `INSERT INTO sot.entity_edits (
         entity_type, entity_id, edit_type, field_name,
         new_value, edit_source, reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        step.entity_type,
        personId,
        step.edit_type,
        step.field_name,
        JSON.stringify(newValueObj),
        step.edit_source,
        step.reason,
      ]
    );
  }

  private async executeSqlStep(
    step: SqlStep,
    personId: string,
    mapped: Record<string, unknown>
  ): Promise<void> {
    // Resolve param references: "$person_id" or "$fieldname"
    const params = step.params.map((p) => {
      if (p === "$person_id") return personId;
      if (p.startsWith("$")) return mapped[p.slice(1)] ?? null;
      return p;
    });

    await query(step.query, params);
  }

  // --------------------------------------------------------------------------
  // Run + record logging
  // --------------------------------------------------------------------------

  /** Create a run row upfront so per-record logs can reference it */
  private async createRun(
    config: SyncConfig,
    triggerType: string
  ): Promise<string | null> {
    try {
      const row = await queryOne<{ run_id: string }>(
        `INSERT INTO ops.airtable_sync_runs (
           config_id, config_name, trigger_type,
           started_at, records_found, records_synced, records_errored,
           results, duration_ms
         ) VALUES ($1, $2, $3, NOW(), 0, 0, 0, '[]', 0)
         RETURNING run_id`,
        [config.config_id, config.name, triggerType]
      );
      return row?.run_id ?? null;
    } catch (err) {
      console.error("[SYNC-ENGINE] Failed to create run:", err);
      return null;
    }
  }

  /** Update a run row with final results */
  private async completeRun(
    runId: string | null,
    result: SyncRunResult
  ): Promise<void> {
    if (!runId) return;
    try {
      await query(
        `UPDATE ops.airtable_sync_runs SET
           completed_at = NOW(),
           records_found = $1,
           records_synced = $2,
           records_errored = $3,
           results = $4,
           duration_ms = $5,
           error_summary = $6
         WHERE run_id = $7`,
        [
          result.recordsFound,
          result.recordsSynced,
          result.recordsErrored,
          JSON.stringify(
            result.results.map((r) => ({
              recordId: r.recordId,
              success: r.success,
              entityId: r.entityId,
              matchType: r.matchType,
              error: r.error,
            }))
          ),
          result.durationMs,
          result.error || null,
          runId,
        ]
      );
    } catch (err) {
      console.error("[SYNC-ENGINE] Failed to complete run:", err);
    }
  }

  /** For legacy code paths that don't process records (skip/inactive) */
  private async logRun(
    config: SyncConfig,
    triggerType: string,
    result: SyncRunResult
  ): Promise<void> {
    try {
      await queryOne(
        `INSERT INTO ops.airtable_sync_runs (
           config_id, config_name, trigger_type,
           started_at, completed_at,
           records_found, records_synced, records_errored,
           results, duration_ms, error_summary
         ) VALUES (
           $1, $2, $3,
           NOW() - ($4 || ' milliseconds')::interval, NOW(),
           $5, $6, $7,
           $8, $4, $9
         )`,
        [
          config.config_id,
          config.name,
          triggerType,
          result.durationMs,
          result.recordsFound,
          result.recordsSynced,
          result.recordsErrored,
          JSON.stringify(
            result.results.map((r) => ({
              recordId: r.recordId,
              success: r.success,
              entityId: r.entityId,
              matchType: r.matchType,
              error: r.error,
            }))
          ),
          result.error || null,
        ]
      );
    } catch (err) {
      console.error("[SYNC-ENGINE] Failed to log run:", err);
    }
  }

  /** Log a single record to the audit trail (every record, every outcome) */
  private async logRecord(
    config: SyncConfig,
    record: AirtableRecord,
    mapped: Record<string, unknown>,
    result: RecordResult,
    runId?: string | null
  ): Promise<void> {
    const status = result.auditStatus || (result.success ? "synced" : "error");
    try {
      await queryOne(
        `INSERT INTO ops.airtable_sync_records (
           config_id, config_name, run_id,
           airtable_record_id, raw_fields, mapped_fields,
           status, entity_id, match_type,
           rejection_reason, error_message, identity_result
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          config.config_id,
          config.name,
          runId || null,
          record.id,
          JSON.stringify(record.fields),
          JSON.stringify(mapped),
          status,
          result.entityId || null,
          result.matchType || null,
          result.rejectionReason || null,
          status === "error" ? result.error || null : null,
          result.identityResult ? JSON.stringify(result.identityResult) : null,
        ]
      );
    } catch (err) {
      console.error("[SYNC-ENGINE] Failed to log record:", err);
    }
  }

  private async updateConfigLastSync(
    config: SyncConfig,
    result: SyncRunResult
  ): Promise<void> {
    try {
      const status = result.error
        ? "error"
        : result.recordsErrored > 0
          ? "partial"
          : "success";

      await query(
        `UPDATE ops.airtable_sync_configs SET
           last_sync_at = NOW(),
           last_sync_status = $1,
           last_sync_count = $2,
           updated_at = NOW()
         WHERE config_id = $3`,
        [status, result.recordsSynced, config.config_id]
      );
    } catch (err) {
      console.error("[SYNC-ENGINE] Failed to update config tracking:", err);
    }
  }
}
