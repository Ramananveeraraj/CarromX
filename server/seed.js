import { query, initDb } from './db.js';

export async function seedData() {
  await initDb();

  // Ensure primary Super Admin account exists for carrromx@gmail.com
  const adminCheck = await query('SELECT * FROM users WHERE email = $1', ['carrromx@gmail.com']);
  if (adminCheck.rows.length === 0) {
    console.log('Creating primary Super Admin account for carrromx@gmail.com...');
    await query(
      `INSERT INTO users (user_id, full_name, phone_number, email, role, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      ['usr_admin_carromx', 'CarromX Admin', '+919876543210', 'carrromx@gmail.com', 'super_admin', 'Ramanan@03']
    );
  } else {
    // Ensure Super Admin is always pinned to dedicated admin phone +919876543210
    // and has master password Ramanan@03 set
    await query(
      "UPDATE users SET phone_number = '+919876543210', role = 'super_admin', password_hash = 'Ramanan@03' WHERE user_id = 'usr_admin_carromx'"
    ).catch(() => {});
  }
}
