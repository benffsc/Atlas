import pg from "pg";

const V1_DB_URL = "postgresql://postgres.tpjllrfpdlkenbapvpko:vfh0xba%21ujx%21gwz%21UGJ@aws-1-us-east-2.pooler.supabase.com:6543/postgres";
const V2_DB_URL = "postgresql://postgres.afxpboxisgoxttyrbtpw:BfuM42NhYjPfLY%21%40vdBV@aws-0-us-west-2.pooler.supabase.com:5432/postgres";

const v1Pool = new pg.Pool({ connectionString: V1_DB_URL, max: 3 });
const v2Pool = new pg.Pool({ connectionString: V2_DB_URL, max: 3 });

async function main() {
  console.log("=".repeat(60));
  console.log("Migrating Trapper Assignments V1 → V2");
  console.log("=".repeat(60));
  
  // Get V1 assignments
  const v1Assignments = await v1Pool.query(`
    SELECT 
      assignment_id, request_id, trapper_person_id, is_primary,
      assigned_at, unassigned_at, assignment_reason, unassignment_reason,
      source_system, source_record_id, created_at, created_by
    FROM trapper.request_trapper_assignments
  `);
  
  console.log(`Found ${v1Assignments.rows.length} assignments in V1`);
  
  let migrated = 0, skipped = 0, errors = 0;
  
  for (const a of v1Assignments.rows) {
    // Check if request exists in V2
    const reqCheck = await v2Pool.query(`SELECT request_id FROM ops.requests WHERE request_id = $1`, [a.request_id]);
    if (reqCheck.rows.length === 0) {
      console.log(`  Skipping ${a.assignment_id} - request ${a.request_id} not in V2`);
      skipped++;
      continue;
    }
    
    // Check if trapper person exists in V2
    const personCheck = await v2Pool.query(`SELECT person_id FROM sot.people WHERE person_id = $1`, [a.trapper_person_id]);
    if (personCheck.rows.length === 0) {
      // Try to match by email from V1
      const v1PersonEmail = await v1Pool.query(`
        SELECT pi.id_value_norm FROM trapper.person_identifiers pi
        WHERE pi.person_id = $1 AND pi.id_type = 'email' LIMIT 1
      `, [a.trapper_person_id]);
      
      if (v1PersonEmail.rows.length > 0) {
        const v2PersonMatch = await v2Pool.query(`
          SELECT p.person_id FROM sot.people p
          JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
          WHERE pi.id_value_norm = $1 LIMIT 1
        `, [v1PersonEmail.rows[0].id_value_norm]);
        
        if (v2PersonMatch.rows.length > 0) {
          a.trapper_person_id = v2PersonMatch.rows[0].person_id;
        } else {
          console.log(`  Skipping ${a.assignment_id} - no V2 match for trapper ${a.trapper_person_id}`);
          skipped++;
          continue;
        }
      } else {
        console.log(`  Skipping ${a.assignment_id} - trapper ${a.trapper_person_id} has no email`);
        skipped++;
        continue;
      }
    }
    
    // Build notes from reasons
    const notes = [
      a.assignment_reason ? `Assignment: ${a.assignment_reason}` : null,
      a.unassignment_reason ? `Unassignment: ${a.unassignment_reason}` : null
    ].filter(Boolean).join('; ') || null;
    
    // Map status based on unassigned_at
    const status = a.unassigned_at ? 'completed' : 'active';
    const assignmentType = a.is_primary ? 'primary' : 'secondary';
    
    try {
      await v2Pool.query(`
        INSERT INTO ops.request_trapper_assignments (
          id, request_id, trapper_person_id, assignment_type, status,
          assigned_by, assigned_at, completed_at, notes, source_system, created_at, migrated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (id) DO NOTHING
      `, [
        a.assignment_id, a.request_id, a.trapper_person_id, assignmentType, status,
        a.created_by, a.assigned_at, a.unassigned_at, notes, a.source_system || 'atlas', a.created_at
      ]);
      migrated++;
    } catch (err) {
      console.error(`  Error migrating ${a.assignment_id}:`, err);
      errors++;
    }
  }
  
  console.log(`\nMigrated: ${migrated}, Skipped: ${skipped}, Errors: ${errors}`);
  
  await v1Pool.end();
  await v2Pool.end();
}

main().catch(console.error);
