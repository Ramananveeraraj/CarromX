import jwt from 'jsonwebtoken';
import { query } from './db.js';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'carromx-super-secret-jwt-key-2026';

// In-memory OTP store with 5-minute expiry (phone -> { otp, expiresAt })
const otpStore = new Map();

/**
 * Generate and store a 6-digit OTP for an identifier (phone or email)
 */
export function generateOtp(identifier) {
  const cleanKey = identifier.trim().toLowerCase();
  // Standard 6-digit numeric OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  otpStore.set(cleanKey, { otp, expiresAt });
  return otp;
}

/**
 * Store same OTP across multiple keys (e.g. both email and phone number)
 */
export function storeOtpForKeys(keys, otp) {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  for (const k of keys) {
    if (k) {
      otpStore.set(k.trim().toLowerCase(), { otp, expiresAt });
    }
  }
}

/**
 * Verify OTP
 */
export function verifyStoredOtp(phoneNumber, inputOtp) {
  const cleanPhone = phoneNumber.trim();
  // Allow master passwords '123456' or 'Ramanan@03' for instant access
  if (inputOtp === '123456' || inputOtp === 'Ramanan@03') return true;

  const record = otpStore.get(cleanPhone);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    otpStore.delete(cleanPhone);
    return false;
  }
  if (record.otp === inputOtp.trim()) {
    otpStore.delete(cleanPhone);
    return true;
  }
  return false;
}

/**
 * Issue JWT Token
 */
export function generateToken(user) {
  return jwt.sign(
    {
      userId: user.user_id,
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Express Middleware: Authenticate JWT
 */
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    // Fetch fresh user data from DB
    try {
      const result = await query('SELECT * FROM users WHERE user_id = $1', [decoded.userId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      req.user = result.rows[0];
      // Allow dynamic role simulation header if requested for testing:
      if (req.headers['x-carromx-active-role']) {
        req.user.activeRole = req.headers['x-carromx-active-role'];
      } else {
        req.user.activeRole = req.user.role;
      }
      next();
    } catch (dbErr) {
      return res.status(500).json({ error: 'Database authentication check failed', details: dbErr.message });
    }
  });
}

/**
 * Normalize role strings across synonyms
 */
export function normalizeRole(role) {
  if (!role) return 'player';
  const r = role.toLowerCase().trim();
  if (r === 'super_admin' || r === 'help_desk' || r === 'admin') return 'super_admin';
  if (r === 'organizer' || r === 'organiser') return 'organizer';
  return 'player';
}

/**
 * Helper: Check if user has management permissions over a specific tournament
 * - Super Admin: Has universal override power over all tournaments
 * - Organiser: Only has ownership over tournaments they created
 * - Player: Read-only, no management authorization
 */
export async function checkTournamentOwnership(tournamentId, user) {
  if (!user) return { authorized: false, isSuperAdmin: false, isOwner: false };
  const currentRole = normalizeRole(user.activeRole || user.role);
  if (currentRole === 'super_admin') {
    return { authorized: true, isSuperAdmin: true, isOwner: true };
  }
  if (currentRole === 'organizer' || currentRole === 'co_organizer') {
    const tourRes = await query('SELECT organizer_id FROM tournaments WHERE tournament_id = $1', [tournamentId]);
    if (tourRes.rows.length > 0) {
      const orgId = tourRes.rows[0].organizer_id;
      // Creator has full ownership
      if (orgId === user.user_id) {
        return { authorized: true, isSuperAdmin: false, isOwner: true };
      }
      // Check co-organizer official assignment
      try {
        const offRes = await query(
          `SELECT official_role FROM tournament_officials 
           WHERE tournament_id = $1 AND user_id = $2 AND official_role = 'co_organizer'`,
          [tournamentId, user.user_id]
        );
        if (offRes.rows.length > 0) {
          return { authorized: true, isSuperAdmin: false, isOwner: true, isCoOrganizer: true };
        }
      } catch (err) {
        // Table fallback during migration
      }
    }
  }
  return { authorized: false, isSuperAdmin: false, isOwner: false };
}

/**
 * Express Middleware: Require specific dynamic roles
 */
export function requireRoles(...allowedRoles) {
  const normalizedAllowed = allowedRoles.map(normalizeRole);

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Please sign in to continue.' });
    }
    const rawRole = req.user.activeRole || req.user.role;
    const currentRole = normalizeRole(rawRole);

    // Super admin has universal access
    if (currentRole === 'super_admin') {
      return next();
    }

    if (!normalizedAllowed.includes(currentRole)) {
      if (normalizedAllowed.includes('organizer') && currentRole === 'player') {
        return res.status(403).json({
          error: 'Only registered Organisers or Admins can create and host tournaments. You can switch your account role to Organiser to host tournaments.',
          requiresRole: 'organizer',
          currentRole: 'player'
        });
      }
      return res.status(403).json({
        error: `Forbidden: requires one of [${allowedRoles.join(', ')}] role. Current role is '${rawRole}'`,
        requiresRole: allowedRoles[0],
        currentRole: rawRole
      });
    }
    next();
  };
}
