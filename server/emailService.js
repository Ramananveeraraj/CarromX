import nodemailer from 'nodemailer';

/**
 * CarromX Free Email Notification Service
 * Supports 100% Free Gmail SMTP (up to 500 emails/day)
 * or any free SMTP provider (Brevo, Resend, etc.)
 */

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (user && pass) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT, 10) || 465,
      secure: (process.env.SMTP_PORT || '465') === '465',
      auth: { user, pass }
    });
  }
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

  const mailer = getTransporter();

  const subject = `🔔 CarromX Match Alert: Board #${boardNumber} vs ${opponentName}`;
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

  if (mailer) {
    try {
      const fromAddr = process.env.SMTP_FROM || `"CarromX Platform" <${process.env.SMTP_USER}>`;
      const info = await mailer.sendMail({
        from: fromAddr,
        to,
        subject,
        html
      });
      console.log(`[EMAIL-DISPATCH] Sent match alert email to ${to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[EMAIL-ERROR] Failed to send email to ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  } else {
    // Simulator mode (zero config)
    console.log(`[EMAIL-DEV-SIMULATOR] Pre-match alert sent to ${to} (Board #${boardNumber} vs ${opponentName})`);
    return { success: true, simulated: true };
  }
}

/**
 * Send OTP Verification Email
 */
export async function sendOtpEmail({ to, recipientName = 'User', otp }) {
  if (!to) return { success: false, reason: 'No email provided' };

  const mailer = getTransporter();
  const subject = `🔐 Your CarromX Verification Code is: ${otp}`;
  const html = `
    <div style="font-family: sans-serif; background: #031c15; color: #f0fdf4; padding: 24px; border-radius: 12px; max-width: 450px; margin: auto;">
      <h2 style="color: #fbbf24; margin-top: 0;">CarromX Login Verification</h2>
      <p style="color: #d1fae5;">Hello ${recipientName},</p>
      <p style="color: #d1fae5;">Use the verification code below to complete your login:</p>
      <div style="background: #021a13; border: 2px dashed #f59e0b; padding: 16px; text-align: center; border-radius: 8px; margin: 20px 0;">
        <span style="font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #fbbf24;">${otp}</span>
      </div>
      <p style="font-size: 12px; color: #6ee7b7;">This code is valid for 10 minutes. Do not share it with anyone.</p>
    </div>
  `;

  if (mailer) {
    try {
      const fromAddr = process.env.SMTP_FROM || `"CarromX Auth" <${process.env.SMTP_USER}>`;
      const info = await mailer.sendMail({ from: fromAddr, to, subject, html });
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[EMAIL-OTP-ERROR] Failed to send OTP to ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  } else {
    console.log(`[EMAIL-DEV-SIMULATOR] OTP for ${to} is: ${otp}`);
    return { success: true, simulated: true };
  }
}
