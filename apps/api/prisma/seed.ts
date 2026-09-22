import { db } from '../src/db.js';
import { hashPassword } from '../src/password.js';

export async function seedDemo() {
  if (process.env.SEED_DEMO !== 'true') throw new Error('Demo seed requires SEED_DEMO=true; never enable for real users.');
  // Empty updates are intentional: reruns never change passwords, roles or live state.
  for (const [name, role] of [['Jashim', 'DRIVER'], ['Nusrat', 'PASSENGER'], ['Rafiq', 'PASSENGER'], ['Shirin', 'PASSENGER']] as const) {
    const email = `${name.toLowerCase()}@demo.dhaka.test`;
    if (!await db.user.findUnique({ where: { email } })) {
      await db.user.upsert({ where: { email }, update: {}, create: { name, email, role, password_hash: await hashPassword('DemoOnly!Dhaka2026') } });
    }
  }
  const jashim = await db.user.findUniqueOrThrow({ where: { email: 'jashim@demo.dhaka.test' } });
  await db.driverProfile.upsert({ where: { user_id: jashim.id }, update: {}, create: { user_id: jashim.id } });
  await db.vehicle.upsert({ where: { driver_id: jashim.id }, update: {}, create: { driver_id: jashim.id, name: 'Bullet', capacity: 3 } });
  for (const name of ['Banani', 'Mohakhali', 'Gulshan 1', 'Dhanmondi', 'Mirpur']) {
    await db.zone.upsert({ where: { name }, update: {}, create: { name } });
  }
  const zones = await db.zone.findMany();
  const zoneId = (name: string) => zones.find(zone => zone.name === name)!.id;
  for (const [pickup, destination, distance, group] of [
    ['Banani', 'Mohakhali', 3000, 'banani-east-demo'],
    ['Banani', 'Gulshan 1', 4000, 'banani-east-demo'],
    ['Dhanmondi', 'Mirpur', 8000, 'west-demo'],
  ] as const) {
    const key = { pickup_zone_id: zoneId(pickup), destination_zone_id: zoneId(destination) };
    await db.route.upsert({ where: { pickup_zone_id_destination_zone_id: key }, update: {}, create: { ...key, demo_distance_meters: distance, compatibility_group: group } });
  }
}

try { await seedDemo(); console.info('Demo seed complete (existing records preserved).'); }
finally { await db.$disconnect(); }
