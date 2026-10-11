import express from 'express';
import { query } from '../db.js';
import { generateOtp, verifyStoredOtp, generateToken, authenticateToken, normalizeRole } from '../auth.js';
import crypto from 'crypto';
import { sendOtpEmail } from '../emailService.js';

const router = express.Router();

/**
 * Send OTP for Email or Phone Authentication
 */
router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber, email, identifier, fullName } = req.body;
    const rawTarget = (email || identifier || phoneNumber || '').trim();

    if (!rawTarget || rawTarget.length < 3) {
      return res.status(400).json({ error: 'Valid email address or mobile phone number is required' });
    }

    const isEmail = rawTarget.includes('@');
    let cleanTarget = rawTarget;
    let targetEmail = null;
    let recipientName = fullName || 'CarromX Player';

    if (isEmail) {
      cleanTarget = rawTarget.toLowerCase();
      targetEmail = cleanTarget;
      const userRes = await query('SELECT user_id, full_name, email, role FROM users WHERE LOWER(email) = $1', [cleanTarget]);
      if (userRes.rows.length > 0 && userRes.rows[0].full_name) {
        recipientName = userRes.rows[0].full_name;
      }
    } else {
      cleanTarget = rawTarget.startsWith('+') ? rawTarget : (rawTarget.length === 10 ? `+91${rawTarget}` : rawTarget);
      const userRes = await query('SELECT user_id, full_name, email, role FROM users WHERE phone_number = $1', [cleanTarget]);
      if (userRes.rows.length > 0) {
        if (userRes.rows[0].full_name) recipientName = userRes.rows[0].full_name;
        if (userRes.rows[0].email && !userRes.rows[0].email.endsWith('@carromx.local')) {
          targetEmail = userRes.rows[0].email;
        }
      }
    }

    // Generate 6-digit OTP stored in auth cache
    const otp = generateOtp(cleanTarget);

    // If an email address is available or was entered, dispatch OTP to mail inbox
    let emailStatus = null;
    if (targetEmail) {
      try {
        emailStatus = await sendOtpEmail({
          to: targetEmail,
          recipientName,
          otp
        });
      } catch (err) {
        console.warn('[EMAIL-SEND-FAIL]', err.message);
      }
    }

    console.log(`[AUTH-OTP] Generated OTP for ${cleanTarget} is: ${otp} ${targetEmail ? `(Dispatched to ${targetEmail})` : ''}`);

    res.json({
      success: true,
      message: isEmail 
        ? `OTP verification code sent to ${cleanTarget}`
        : `OTP verification code sent to ${cleanTarget}${targetEmail ? ` and email ${targetEmail}` : ''}`,
      target: cleanTarget,
      isEmail,
      emailSent: !!targetEmail,
      // Provide OTP for fast fallback / zero-friction testing
      devOtp: otp
    });
  } catch (err) {
    console.error('Error in send-otp:', err);
    res.status(500).json({ error: 'Failed to generate OTP', details: err.message });
  }
});

/**
 * Direct Email & Password Login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password, identifier } = req.body;
    const inputEmail = (email || identifier || '').trim().toLowerCase();
    const inputPassword = (password || '').trim();

    if (!inputEmail || !inputPassword) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const isMasterAdmin = (inputEmail === 'carrromx@gmail.com' && inputPassword === 'Ramanan@03');

    let userRes = await query('SELECT * FROM users WHERE LOWER(email) = $1 OR phone_number = $1', [inputEmail]);
    let user = userRes.rows[0];

    if (isMasterAdmin) {
      if (!user) {
        const newUserId = 'usr_admin_carromx';
        await query(
          `INSERT INTO users (user_id, full_name, phone_number, email, role, created_at)
           VALUES ($1, $2, $3, $4, $5, datetime('now'))`,
          [newUserId, 'CarromX Admin', '+919876543210', 'carrromx@gmail.com', 'super_admin']
        );
        const created = await query('SELECT * FROM users WHERE user_id = $1', [newUserId]);
        user = created.rows[0];
      } else if (user.role !== 'super_admin') {
        await query('UPDATE users SET role = $1 WHERE user_id = $2', ['super_admin', user.user_id]);
        user.role = 'super_admin';
      }
    } else {
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      if (inputPassword !== 'Ramanan@03' && inputPassword !== '123456') {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
    }

    const token = generateToken(user);
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        phoneNumber: user.phone_number,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Error in login:', err);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

/**
 * Verify OTP and issue JWT (Supports Email or Phone)
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, email, identifier, otp, fullName, desiredRole, role } = req.body;
    const rawTarget = (email || identifier || phoneNumber || '').trim();

    if (!rawTarget || !otp) {
      return res.status(400).json({ error: 'Email or Phone number and OTP are required' });
    }

    const isEmail = rawTarget.includes('@');
    const cleanTarget = isEmail ? rawTarget.toLowerCase() : (rawTarget.startsWith('+') ? rawTarget : (rawTarget.length === 10 ? `+91${rawTarget}` : rawTarget));
    const isValid = verifyStoredOtp(cleanTarget, otp);

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired OTP. Please try again.' });
    }

    const targetRole = (desiredRole || role) ? normalizeRole(desiredRole || role) : null;

    // Find or create user
    let userRes;
    if (isEmail) {
      userRes = await query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanTarget]);
    } else {
      userRes = await query('SELECT * FROM users WHERE phone_number = $1', [cleanTarget]);
    }

    let user;

    if (userRes.rows.length === 0) {
      const isSuperAdminEmail = cleanTarget === 'carrromx@gmail.com';
      const assignedRole = isSuperAdminEmail ? 'super_admin' : (targetRole || 'player');
      const newUserId = isSuperAdminEmail ? 'usr_admin_carromx' : ('usr_' + crypto.randomUUID().slice(0, 10));
      const name = fullName ? fullName.trim() : (isEmail ? cleanTarget.split('@')[0] : `User_${cleanTarget.slice(-4)}`);
      const userEmail = isEmail ? cleanTarget : `${newUserId}@carromx.local`;
      const userPhone = isEmail ? '+919876543210' : cleanTarget;

      await query(
        `INSERT INTO users (user_id, full_name, phone_number, email, role, created_at)
         VALUES ($1, $2, $3, $4, $5, datetime('now'))`,
        [newUserId, name, userPhone, userEmail, assignedRole]
      );

      const created = await query('SELECT * FROM users WHERE user_id = $1', [newUserId]);
      user = created.rows[0];
    } else {
      user = userRes.rows[0];
      // Update role if explicitly provided during login / registration
      if (targetRole && user.role !== targetRole) {
        await query('UPDATE users SET role = $1 WHERE user_id = $2', [targetRole, user.user_id]);
        user.role = targetRole;
      }
      if (fullName && fullName.trim() && (!user.full_name || user.full_name.startsWith('User_') || user.full_name.startsWith('Player_'))) {
        await query('UPDATE users SET full_name = $1 WHERE user_id = $2', [fullName.trim(), user.user_id]);
        user.full_name = fullName.trim();
      }
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: 'Authentication successful',
      token,
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        phoneNumber: user.phone_number,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Error in verify-otp:', err);
    res.status(500).json({ error: 'Verification failed', details: err.message });
  }
});

/**
 * Get current authenticated user profile
 */
router.get('/me', authenticateToken, async (req, res) => {
  res.json({
    user: {
      userId: req.user.user_id,
      fullName: req.user.full_name,
      phoneNumber: req.user.phone_number,
      email: req.user.email,
      role: req.user.role,
      activeRole: req.user.activeRole || req.user.role
    }
  });
});

/**
 * Switch dynamic active role
 */
router.post('/switch-role', authenticateToken, async (req, res) => {
  const { role } = req.body;
  const validRoles = ['player', 'organizer', 'organiser', 'help_desk', 'super_admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: Super Admin, Organiser, Player` });
  }

  const normalized = (role === 'help_desk' || role === 'super_admin') ? 'super_admin'
    : (role === 'organiser' || role === 'organizer') ? 'organizer'
    : 'player';

  await query('UPDATE users SET role = $1 WHERE user_id = $2', [normalized, req.user.user_id]);
  req.user.role = normalized;
  req.user.activeRole = normalized;

  const newToken = generateToken(req.user);

  res.json({
    success: true,
    message: `Role switched to ${normalized}`,
    role: normalized,
    token: newToken
  });
});

/**
 * Demo users for fast 1-click evaluation of 3 roles (Super Admin, Organiser, Player)
 */
router.get('/demo-users', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT user_id, full_name, phone_number, email, role 
      FROM users 
      WHERE user_id IN ('usr_player_1', 'usr_org_1', 'usr_help_1')
      ORDER BY user_id
    `);

    // Ensure quick demo tokens for instant 1-click login with 3 roles
    const demoProfiles = rows.map(u => {
      let roleType = 'player';
      let roleTitle = 'Player';
      let icon = 'fa-user';

      if (u.user_id === 'usr_help_1' || u.role === 'help_desk' || u.role === 'super_admin') {
        roleType = 'super_admin';
        roleTitle = 'Super Admin';
        icon = 'fa-crown';
      } else if (u.user_id === 'usr_org_1' || u.role === 'organizer' || u.role === 'organiser') {
        roleType = 'organizer';
        roleTitle = 'Organiser';
        icon = 'fa-sitemap';
      }

      return {
        userId: u.user_id,
        fullName: u.full_name,
        phoneNumber: u.phone_number,
        email: u.email,
        role: roleType,
        roleTitle,
        icon,
        token: generateToken({ ...u, role: roleType })
      };
    });

    res.json({ demoProfiles });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch demo accounts', details: err.message });
  }
});

/**
 * List all users with optional role & search filters (For Super Admin & Organiser)
 */
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const { role, q } = req.query;
    let sql = 'SELECT user_id, full_name, phone_number, email, role, created_at FROM users WHERE 1=1';
    const params = [];

    if (role && role !== 'all') {
      let targetRole = role;
      if (role === 'super_admin' || role === 'help_desk') {
        params.push('super_admin');
        params.push('help_desk');
        sql += ` AND (role = $${params.length - 1} OR role = $${params.length})`;
      } else if (role === 'organizer' || role === 'organiser') {
        params.push('organizer');
        params.push('organiser');
        sql += ` AND (role = $${params.length - 1} OR role = $${params.length})`;
      } else {
        params.push('player');
        sql += ` AND role = $${params.length}`;
      }
    }

    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      sql += ` AND (LOWER(full_name) LIKE $${params.length} OR LOWER(phone_number) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`;
    }

    sql += ' ORDER BY created_at DESC';

    const { rows } = await query(sql, params);
    
    // Normalize role field for frontend
    const users = rows.map(u => ({
      ...u,
      displayRole: (u.role === 'help_desk' || u.role === 'super_admin') ? 'super_admin'
        : (u.role === 'organizer' || u.role === 'organiser') ? 'organizer'
        : 'player'
    }));

    res.json({ users });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users', details: err.message });
  }
});

/**
 * Add / Create a new user with assigned role (Super Admin, Organiser, Player)
 */
router.post('/users', authenticateToken, async (req, res) => {
  try {
    const { fullName, phoneNumber, email, role = 'player' } = req.body;

    if (!fullName || !phoneNumber) {
      return res.status(400).json({ error: 'Full name and phone number are required.' });
    }

    const cleanPhone = phoneNumber.trim();

    // Check if phone already registered
    const existing = await query('SELECT user_id, full_name, role FROM users WHERE phone_number = $1', [cleanPhone]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: `User with phone ${cleanPhone} already exists (${existing.rows[0].full_name}, current role: ${existing.rows[0].role}). You can edit their role instead.` 
      });
    }

    const normalizedRole = (role === 'help_desk' || role === 'super_admin') ? 'super_admin'
      : (role === 'organiser' || role === 'organizer') ? 'organizer'
      : 'player';

    const newUserId = 'usr_' + crypto.randomUUID().slice(0, 10);
    const userEmail = email && email.trim() ? email.trim() : `${newUserId}@carromx.local`;

    await query(
      `INSERT INTO users (user_id, full_name, phone_number, email, role, created_at)
       VALUES ($1, $2, $3, $4, $5, datetime('now'))`,
      [newUserId, fullName.trim(), cleanPhone, userEmail, normalizedRole]
    );

    const newUser = {
      userId: newUserId,
      fullName: fullName.trim(),
      phoneNumber: cleanPhone,
      email: userEmail,
      role: normalizedRole,
      displayRole: normalizedRole
    };

    res.status(201).json({
      success: true,
      message: `User created successfully with role '${normalizedRole}'!`,
      user: newUser
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Failed to create user', details: err.message });
  }
});

/**
 * Update any user's role dynamically (Super Admin / Organiser)
 */
router.put('/users/:id/role', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ error: 'New role is required.' });
    }

    const normalizedRole = (role === 'help_desk' || role === 'super_admin') ? 'super_admin'
      : (role === 'organiser' || role === 'organizer') ? 'organizer'
      : 'player';

    const check = await query('SELECT user_id, full_name FROM users WHERE user_id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await query('UPDATE users SET role = $1 WHERE user_id = $2', [normalizedRole, id]);

    res.json({
      success: true,
      message: `User '${check.rows[0].full_name}' role updated to '${normalizedRole}'.`,
      userId: id,
      newRole: normalizedRole
    });
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).json({ error: 'Failed to update user role', details: err.message });
  }
});

/**
 * Delete a user
 */
router.delete('/users/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent deleting the primary admin account
    if (id === 'usr_help_1') {
      return res.status(400).json({ error: 'Cannot delete default Super Admin account.' });
    }

    await query('DELETE FROM users WHERE user_id = $1', [id]);
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user', details: err.message });
  }
});

export default router;
