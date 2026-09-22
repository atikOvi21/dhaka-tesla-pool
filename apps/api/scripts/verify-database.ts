import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { env } from '../src/config.js';

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
let checks = 0;
async function rejects(sql: string, values: unknown[], constraint: string) {
  await client.query('SAVEPOINT invalid_input');
  try {
    await client.query(sql, values);
    assert.fail('Expected database rejection: ' + constraint);
  } catch (error) {
    assert.equal((error as { constraint?: string }).constraint, constraint);
    checks++;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT invalid_input');
  }
}
try {
  // Snapshot all ten tables, so reruns cannot silently erase application rows.
  const tables = ['users','sessions','driver_profiles','vehicles','zones','routes','ride_requests','pools','pool_memberships','ride_events'];
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of tables) {
      const rows = await client.query('SELECT row_to_json(t) AS row FROM ' + table + ' t ORDER BY row_to_json(t)::text');
      result[table] = rows.rows;
    }
    return result;
  };
  const before = await snapshot();
  for (let repeat = 0; repeat < 2; repeat++) {
    execFileSync(process.execPath, [resolve('../../node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'], { env: { ...process.env, SEED_DEMO: 'true' }, stdio: 'pipe' });
    assert.deepEqual(await snapshot(), before);
    checks++;
  }
  const cast = await client.query("SELECT name,role,password_hash FROM users WHERE email LIKE '%@demo.dhaka.test' ORDER BY name");
  assert.equal(cast.rowCount, 4);
  for (const user of cast.rows) assert.match(user.password_hash, /^scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(new Set(cast.rows.map(row => row.password_hash)).size, 4);
  checks++;
  await client.query('BEGIN');
  const passenger = randomUUID(), driver = randomUUID(), vehicle = randomUUID(), pool = randomUUID(), request = randomUUID();
  const route = (await client.query('SELECT * FROM routes LIMIT 1')).rows[0];
  assert.ok(route);
  await client.query("INSERT INTO users (id,email,name,password_hash,role,updated_at) VALUES ($1,$2,'Constraint passenger','test-hash','PASSENGER',now()),($3,$4,'Constraint driver','test-hash','DRIVER',now())", [passenger, passenger+'@test.invalid', driver, driver+'@test.invalid']);
  await rejects("INSERT INTO driver_profiles(user_id,role,updated_at) VALUES ($1,'DRIVER',now())", [passenger], 'driver_profiles_user_id_role_fkey');
  await rejects("INSERT INTO driver_profiles(user_id,role,updated_at) VALUES ($1,'PASSENGER',now())", [passenger], 'driver_profiles_driver_role');
  await rejects("INSERT INTO vehicles(id,driver_id,name,capacity) VALUES ($1,$2,'Invalid',0)", [randomUUID(),driver], 'vehicles_positive_capacity');
  await client.query("INSERT INTO vehicles(id,driver_id,name,capacity) VALUES ($1,$2,'Test vehicle',3)", [vehicle,driver]);
  const poolSql = "INSERT INTO pools(id,vehicle_id,capacity_snapshot,allocated_seats,pickup_zone_id,route_group,updated_at) VALUES ($1,$2,3,$3,$4,'test',now())";
  await rejects(poolSql,[randomUUID(),vehicle,4,route.pickup_zone_id],'pools_capacity_bounds');
  await client.query(poolSql,[pool,vehicle,0,route.pickup_zone_id]);
  await rejects(poolSql,[randomUUID(),vehicle,0,route.pickup_zone_id],'one_active_pool_per_vehicle');
  const requestSql = "INSERT INTO ride_requests(id,passenger_id,route_id,seats,idempotency_key,payload_fingerprint,pricing_version,distance_meters,base_fare_poisha,rate_per_km_poisha,solo_maximum_poisha,provisional_pooled_poisha,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'test',3000,2000,1000,5000,4000,now())";
  const args = [request,passenger,route.id,1,'test-key','a'.repeat(64)];
  await rejects(requestSql,[randomUUID(),passenger,route.id,0,'zero','a'.repeat(64)],'ride_requests_positive_seats');
  await rejects(requestSql,[randomUUID(),driver,route.id,1,'driver','a'.repeat(64)],'ride_requests_passenger_id_passenger_role_fkey');
  await client.query(requestSql,args);
  await rejects(requestSql,[randomUUID(),passenger,route.id,1,'second','a'.repeat(64)],'one_active_booking_per_passenger');
  await rejects("UPDATE ride_requests SET final_fare_poisha=4000 WHERE id=$1",[request],'ride_requests_finalization');
  await client.query("INSERT INTO pool_memberships(id,request_id,pool_id,seats) VALUES ($1,$2,$3,1)",[randomUUID(),request,pool]);
  await rejects("UPDATE pool_memberships SET released_at=now() WHERE request_id=$1",[request],'memberships_release_consistent');
  await rejects("INSERT INTO pool_memberships(id,request_id,pool_id,seats) VALUES ($1,$2,$3,1)",[randomUUID(),request,pool],'pool_memberships_request_id_key');
  await rejects("INSERT INTO ride_events(id,event_type,operation_key) VALUES ($1,'REQUEST_CREATED',$2)",[randomUUID(),randomUUID()],'events_has_subject');
  await client.query("UPDATE ride_requests SET status='CANCELLED' WHERE id=$1",[request]);
  await rejects(requestSql,[randomUUID(),passenger,route.id,1,'test-key','a'.repeat(64)],'ride_requests_passenger_id_idempotency_key_key');
  await client.query(requestSql,[randomUUID(),passenger,route.id,1,'new-key','a'.repeat(64)]);
  checks++;
  console.info('PASS: ' + checks + ' PostgreSQL/seed checks; constraint fixtures rolled back. These are not pooling concurrency tests.');
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
