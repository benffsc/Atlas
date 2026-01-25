import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

async function runQueries() {
  try {
    await client.connect();

    // First check sot_people columns
    const peopleCols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'trapper' AND table_name = 'sot_people'
      ORDER BY ordinal_position;
    `);
    console.log('sot_people columns:');
    console.table(peopleCols.rows);

    // Query 7: Example polluted cats with their places
    console.log('\n' + '='.repeat(60));
    console.log('Query 7: Top 5 most polluted cats with details');
    console.log('='.repeat(60));
    const result7 = await client.query(`
      WITH cat_place_counts AS (
        SELECT 
          c.cat_id,
          c.display_name,
          COUNT(DISTINCT cpr.place_id) as place_count
        FROM trapper.sot_cats c
        LEFT JOIN trapper.cat_place_relationships cpr ON c.cat_id = cpr.cat_id
        GROUP BY c.cat_id, c.display_name
      )
      SELECT 
        c.cat_id,
        c.display_name,
        cpc.place_count,
        STRING_AGG(DISTINCT pl.address, ' | ' ORDER BY pl.address LIMIT 10) as sample_places,
        STRING_AGG(DISTINCT cpr.source_system, ', ') as source_systems
      FROM cat_place_counts cpc
      JOIN trapper.sot_cats c ON c.cat_id = cpc.cat_id
      LEFT JOIN trapper.cat_place_relationships cpr ON c.cat_id = cpr.cat_id
      LEFT JOIN trapper.places pl ON cpr.place_id = pl.id
      WHERE cpc.place_count > 50
      GROUP BY c.cat_id, c.display_name, cpc.place_count
      ORDER BY cpc.place_count DESC;
    `);
    console.log('\nTop heavily polluted cats (>50 places):');
    result7.rows.forEach(row => {
      console.log(`\nCat ID: ${row.cat_id}`);
      console.log(`  Name: ${row.display_name}`);
      console.log(`  Total place count: ${row.place_count}`);
      console.log(`  Source systems: ${row.source_systems}`);
      console.log(`  Sample places (showing 10):`);
      if (row.sample_places) {
        row.sample_places.split(' | ').forEach(place => console.log(`    - ${place}`));
      }
    });

    // Query 8: Analysis by source combination
    console.log('\n' + '='.repeat(60));
    console.log('Query 8: Breakdown of problematic sources');
    console.log('='.repeat(60));
    
    const result8 = await client.query(`
      SELECT 
        source_system,
        source_table,
        COUNT(*) as total_relationships,
        COUNT(DISTINCT cat_id) as cats_affected,
        COUNT(DISTINCT place_id) as places_affected,
        ROUND(100.0 * COUNT(*) / 
          (SELECT COUNT(*) FROM trapper.cat_place_relationships), 2) as pct_of_total
      FROM trapper.cat_place_relationships
      WHERE source_system IS NOT NULL AND source_table IS NOT NULL
      GROUP BY source_system, source_table
      ORDER BY COUNT(*) DESC;
    `);
    console.table(result8.rows);

    // Query 9: Deep dive into the 319-place cats
    console.log('\n' + '='.repeat(60));
    console.log('Query 9: Analysis of 319-place cats');
    console.log('='.repeat(60));
    const result9 = await client.query(`
      SELECT 
        c.cat_id,
        c.display_name,
        COUNT(DISTINCT cpr.place_id) as place_count,
        COUNT(DISTINCT cpr.source_system) as source_system_count,
        STRING_AGG(DISTINCT cpr.source_system, ', ' ORDER BY cpr.source_system) as sources,
        STRING_AGG(DISTINCT cpr.source_table, ', ' ORDER BY cpr.source_table) as tables
      FROM trapper.sot_cats c
      JOIN trapper.cat_place_relationships cpr ON c.cat_id = cpr.cat_id
      WHERE c.cat_id IN (
        '1138e3da-281b-40ae-981b-4468ea8e16f9',
        '1da4fd22-0271-4928-a8ac-5ad2d6f51ae0',
        '3f3df8a2-0327-4eb5-8db6-1ce378e21c40',
        'b5cc8f56-676e-40d9-9f35-35b609c22ec6',
        'f5735c05-efba-4804-aa66-2f2aec5e8aa0'
      )
      GROUP BY c.cat_id, c.display_name;
    `);
    console.log('\nDetailed analysis of 319-place cats:');
    console.table(result9.rows);

    // Query 10: Check which source creates the 319 relationships
    console.log('\n' + '='.repeat(60));
    console.log('Query 10: Breaking down the 319-place cat sources');
    console.log('='.repeat(60));
    const result10 = await client.query(`
      SELECT 
        source_system,
        source_table,
        COUNT(*) as count
      FROM trapper.cat_place_relationships
      WHERE cat_id = '1138e3da-281b-40ae-981b-4468ea8e16f9'
      GROUP BY source_system, source_table
      ORDER BY count DESC;
    `);
    console.table(result10.rows);

    // Query 11: Count of cats with very high place counts
    console.log('\n' + '='.repeat(60));
    console.log('Query 11: Distribution of cats by place count');
    console.log('='.repeat(60));
    const result11 = await client.query(`
      WITH place_counts AS (
        SELECT 
          c.cat_id,
          COUNT(DISTINCT cpr.place_id) as place_count
        FROM trapper.sot_cats c
        LEFT JOIN trapper.cat_place_relationships cpr ON c.cat_id = cpr.cat_id
        GROUP BY c.cat_id
      )
      SELECT 
        CASE 
          WHEN place_count = 0 THEN '0 places'
          WHEN place_count = 1 THEN '1 place'
          WHEN place_count BETWEEN 2 AND 5 THEN '2-5 places'
          WHEN place_count BETWEEN 6 AND 10 THEN '6-10 places'
          WHEN place_count BETWEEN 11 AND 50 THEN '11-50 places'
          WHEN place_count BETWEEN 51 AND 100 THEN '51-100 places'
          WHEN place_count BETWEEN 101 AND 319 THEN '101-319 places'
          ELSE '320+ places'
        END as place_bucket,
        COUNT(*) as cat_count,
        MIN(place_count) as min_places,
        MAX(place_count) as max_places
      FROM place_counts
      GROUP BY place_bucket
      ORDER BY MIN(place_count);
    `);
    console.table(result11.rows);

  } catch (err) {
    console.error('Query error:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runQueries();
