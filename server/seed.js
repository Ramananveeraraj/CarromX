import { query, initDb } from './db.js';

export async function seedData() {
  await initDb();

  // Ensure primary Super Admin account exists for carrromx@gmail.com
  const adminCheck = await query('SELECT * FROM users WHERE email = $1', ['carrromx@gmail.com']);
  if (adminCheck.rows.length === 0) {
    console.log('Creating primary Super Admin account for carrromx@gmail.com...');
    await query(
      `INSERT INTO users (user_id, full_name, phone_number, email, role, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      ['usr_admin_carromx', 'CarromX Admin', '+919876543210', 'carrromx@gmail.com', 'super_admin']
    );
  } else {
    // Ensure Super Admin is always pinned to dedicated admin phone +919876543210
    // so it never locks personal user phone numbers (like +919600436921)!
    await query(
      "UPDATE users SET phone_number = '+919876543210' WHERE user_id = 'usr_admin_carromx' AND phone_number != '+919876543210'"
    ).catch(() => {});
  }
}
