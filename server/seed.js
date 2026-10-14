import { query, initDb } from './db.js';

export async function seedData() {
  await initDb();

  const ADMIN_PHONE = '+919600436921';
  const ADMIN_EMAIL = 'carrromx@gmail.com';
  const ADMIN_PASS = 'Ramanan@03';

  // Release ADMIN_PHONE and alternate forms if previously held by any non-admin account
  await query(
    "UPDATE users SET phone_number = '+9100' || substr(phone_number, 5) WHERE phone_number IN ($1, $2) AND user_id != 'usr_admin_carromx'",
    [ADMIN_PHONE, '9600436921']
  ).catch(() => {});

  // Ensure primary Super Admin account exists for carrromx@gmail.com
  const adminCheck = await query('SELECT * FROM users WHERE email = $1 OR user_id = $2', [ADMIN_EMAIL, 'usr_admin_carromx']);
  if (adminCheck.rows.length === 0) {
    console.log(`Creating primary Super Admin account for ${ADMIN_EMAIL}...`);
    await query(
      `INSERT INTO users (user_id, full_name, phone_number, email, role, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      ['usr_admin_carromx', 'CarromX Admin', ADMIN_PHONE, ADMIN_EMAIL, 'super_admin', ADMIN_PASS]
    );
  } else {
    // Ensure Super Admin is always pinned to dedicated admin phone +919600436921, email, and password
    await query(
      `UPDATE users 
       SET phone_number = $1, email = $2, role = 'super_admin', password_hash = $3 
       WHERE user_id = 'usr_admin_carromx' OR LOWER(email) = $4`,
      [ADMIN_PHONE, ADMIN_EMAIL, ADMIN_PASS, ADMIN_EMAIL]
    ).catch((err) => {
      console.warn('Seed admin update notice:', err.message);
    });
  }
}
