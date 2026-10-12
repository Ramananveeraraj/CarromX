import 'dotenv/config';
import nodemailer from 'nodemailer';

/**
 * CarromX Free Email Notification Service
 * Primary: 100% Free Official Gmail SMTP
 * Fallback: Master App Password retry & simulation
 */

const GMAIL_USER = 'carrromx@gmail.com';
const MASTER_APP_PASS = 'ocdzrpuxoipislrz';

let transporter = null;

function createGmailTransport(password) {
  const cleanPass = (password || MASTER_APP_PASS).replace(/[\s"']/g, '');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: cleanPass
    },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 12000
  });
}

function getTransporter() {
  if (transporter) return transporter;
  const envPass = (process.env.SMTP_PASS || MASTER_APP_PASS).replace(/[\s"']/g, '');
  transporter = createGmailTransport(envPass);
  return transporter;
}

/**
 * Send 10-Minute Pre-Match Alert Email
 */
export async function sendPreMatchEmail({
  to,
  recipientName = 'Player',
  opponentName = 'Opponent',
  tournamentTitle = 'CarromX Tournament',
  boardNumber = 'TBA',
  scheduledTime = 'Soon'
}) {
  if (!to) {
    return { success: false, reason: 'No recipient email provided' };
  }

  const subject = `CarromX Match Alert: Board #${boardNumber} vs ${opponentName}`;
  const text = `Hello ${recipientName},\n\nYour CarromX match in "${tournamentTitle}" starts in 10 minutes!\n\nOpponent: ${opponentName}\nAssigned Board: Board #${boardNumber}\nScheduled Time: ${scheduledTime}\n\nPlease report to your board immediately. Failure to report may result in a forfeit.\n\n- The CarromX Team`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #031c15; color: #f0fdf4; margin: 0; padding: 20px; }
        .card { max-width: 550px; margin: 0 auto; background: #062b20; border: 1px solid #0d4a37; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .header { background: #021a13; padding: 20px; text-align: center; border-bottom: 2px solid #f59e0b; }
        .logo { font-size: 24px; font-weight: 900; color: #fbbf24; }
        .badge { display: inline-block; background: #f59e0b; color: #021a13; font-size: 11px; font-weight: bold; padding: 2px 8px; border-radius: 4px; }
        .content { padding: 24px; }
        .alert-box { background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 0 8px 8px 0; }
        .details-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        .details-table td { padding: 10px 12px; border-bottom: 1px solid #0d4a37; font-size: 13px; }
        .details-table td.label { color: #a7f3d0; font-weight: bold; width: 35%; }
        .details-table td.value { color: #ffffff; }
        .board-tag { background: #047857; color: #ffffff; padding: 4px 10px; border-radius: 6px; font-weight: bold; }
        .footer { background: #021a13; padding: 14px; text-align: center; font-size: 11px; color: #6ee7b7; border-top: 1px solid #0d4a37; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <div class="logo">Carrom<span style="color:#f59e0b;">X</span> <span class="badge">10-MIN ALERT</span></div>
          <p style="margin: 6px 0 0; color: #a7f3d0; font-size: 12px;">Official Tournament Notification</p>
        </div>
        <div class="content">
          <h2 style="color: #ffffff; margin-top: 0;">Hello, ${recipientName}!</h2>
          <div class="alert-box">
            <strong style="color: #fbbf24;">⚡ Your match starts in 10 minutes!</strong>
            <p style="margin: 4px 0 0; font-size: 13px; color: #f0fdf4;">Please report to your assigned board immediately.</p>
          </div>
          <table class="details-table">
            <tr>
              <td class="label">Tournament:</td>
              <td class="value"><strong>${tournamentTitle}</strong></td>
            </tr>
            <tr>
              <td class="label">Opponent:</td>
              <td class="value">${opponentName}</td>
            </tr>
            <tr>
              <td class="label">Assigned Board:</td>
              <td class="value"><span class="board-tag">Board #${boardNumber}</span></td>
            </tr>
            <tr>
              <td class="label">Scheduled Time:</td>
              <td class="value">${scheduledTime}</td>
            </tr>
          </table>
          <p style="font-size: 12px; color: #6ee7b7; text-align: center; margin-top: 20px;">
            Failure to report within 10 minutes may result in referee forfeit rules. Good luck!
          </p>
        </div>
        <div class="footer">
          &copy; 2026 CarromX Tournament Platform &bull; Real-time Match Dispatcher
        </div>
      </div>
    </body>
    </html>
  `;

  const fromAddr = `"CarromX Platform" <${GMAIL_USER}>`;
  const mailer = getTransporter();

  try {
    const info = await mailer.sendMail({ from: fromAddr, to, subject, text, html });
    console.log(`[EMAIL-DISPATCH] Sent match alert email to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[EMAIL-RETRY] Retrying with master credentials for ${to}...`);
    try {
      const fallback = createGmailTransport(MASTER_APP_PASS);
      const fbInfo = await fallback.sendMail({ from: fromAddr, to, subject, text, html });
      transporter = fallback;
      return { success: true, messageId: fbInfo.messageId };
    } catch (fbErr) {
      console.error(`[EMAIL-ERROR] Failed to send email to ${to}:`, fbErr.message);
      return { success: false, error: fbErr.message };
    }
  }
}

/**
 * Send OTP Verification Email
 */
export async function sendOtpEmail({ to, recipientName = 'User', otp }) {
  if (!to) return { success: false, reason: 'No email provided' };

  const subject = `CarromX Login Verification Code: ${otp}`;
  const text = `Hello ${recipientName},\n\nYour CarromX login verification code is: ${otp}\n\nThis code is valid for 10 minutes. Do not share it with anyone.\n\nIf you did not request this code, you can safely ignore this email.\n\n- The CarromX Team`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #031c15; color: #f0fdf4; padding: 24px; border-radius: 12px; max-width: 480px; margin: auto; border: 1px solid #0d4a37;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #fbbf24; margin: 0; font-size: 24px;">Carrom<span style="color: #34d399;">X</span></h2>
        <p style="color: #6ee7b7; font-size: 13px; margin: 4px 0 0;">Official Login Verification</p>
      </div>
      <p style="color: #e2e8f0; font-size: 15px;">Hello <strong>${recipientName}</strong>,</p>
      <p style="color: #cbd5e1; font-size: 14px; line-height: 1.5;">Use the 6-digit verification code below to sign in to your CarromX account:</p>
      <div style="background: #021a13; border: 2px dashed #f59e0b; padding: 18px; text-align: center; border-radius: 10px; margin: 20px 0;">
        <span style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #fbbf24; font-family: monospace;">${otp}</span>
      </div>
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 16px 0 0;">
        ⏱️ This code is valid for 10 minutes. If you did not request this code, you can ignore this email safely.
      </p>
    </div>
  `;

  const fromAddr = `"CarromX Security" <${GMAIL_USER}>`;
  const mailer = getTransporter();

  try {
    const info = await mailer.sendMail({ from: fromAddr, to, subject, text, html });
    console.log(`[EMAIL-OTP-SUCCESS] OTP email delivered to ${to} (MessageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[EMAIL-OTP-NOTICE] Primary SMTP failed for ${to} (${err.message}). Retrying with master credentials...`);
    try {
      const fallback = createGmailTransport(MASTER_APP_PASS);
      const fbInfo = await fallback.sendMail({ from: fromAddr, to, subject, text, html });
      console.log(`[EMAIL-OTP-SUCCESS-FALLBACK] OTP email delivered to ${to} via master credentials (MessageId: ${fbInfo.messageId})`);
      transporter = fallback;
      return { success: true, messageId: fbInfo.messageId };
    } catch (fbErr) {
      console.error(`[EMAIL-OTP-FAIL] All SMTP attempts failed for ${to}:`, fbErr.message);
      return { success: false, error: fbErr.message, fallbackOtp: otp };
    }
  }
}

/**
 * Send Password Reset OTP Email
 */
export async function sendPasswordResetEmail({ to, recipientName = 'User', otp }) {
  if (!to) return { success: false, reason: 'No email provided' };

  const subject = `CarromX Password Reset Code: ${otp}`;
  const text = `Hello ${recipientName},\n\nWe received a request to reset your password or master access credentials.\n\nYour 6-digit recovery code is: ${otp}\n\nThis code expires in 10 minutes.\n\n- The CarromX Team`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #031c15; color: #f0fdf4; padding: 24px; border-radius: 12px; max-width: 480px; margin: auto; border: 1px solid #0d4a37;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #fbbf24; margin: 0; font-size: 24px;">Carrom<span style="color: #34d399;">X</span></h2>
        <p style="color: #6ee7b7; font-size: 13px; margin: 4px 0 0;">Password Recovery</p>
      </div>
      <p style="color: #e2e8f0; font-size: 15px;">Hello <strong>${recipientName}</strong>,</p>
      <p style="color: #cbd5e1; font-size: 14px; line-height: 1.5;">We received a request to reset your CarromX password. Use the 6-digit code below to set a new password:</p>
      <div style="background: #021a13; border: 2px dashed #f59e0b; padding: 18px; text-align: center; border-radius: 10px; margin: 20px 0;">
        <span style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #fbbf24; font-family: monospace;">${otp}</span>
      </div>
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 16px 0 0;">
        ⏱️ This code expires in 10 minutes. If you did not request this reset, your account is safe and you can ignore this email.
      </p>
    </div>
  `;

  const fromAddr = `"CarromX Security" <${GMAIL_USER}>`;
  const mailer = getTransporter();

  try {
    const info = await mailer.sendMail({ from: fromAddr, to, subject, text, html });
    console.log(`[PASSWORD-RESET-EMAIL-SUCCESS] Reset email delivered to ${to} (MessageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[PASSWORD-RESET-RETRY] Retrying with master credentials for ${to}...`);
    try {
      const fallback = createGmailTransport(MASTER_APP_PASS);
      const fbInfo = await fallback.sendMail({ from: fromAddr, to, subject, text, html });
      console.log(`[PASSWORD-RESET-SUCCESS-FALLBACK] Reset email delivered to ${to} (MessageId: ${fbInfo.messageId})`);
      transporter = fallback;
      return { success: true, messageId: fbInfo.messageId };
    } catch (fbErr) {
      console.error(`[PASSWORD-RESET-EMAIL-FAIL] Failed to send to ${to}:`, fbErr.message);
      return { success: false, error: fbErr.message, fallbackOtp: otp };
    }
  }
}
