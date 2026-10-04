const nodemailer = require('nodemailer');

let transporter = null;
const enabled = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

if (enabled) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
} else {
  console.warn('[email] SMTP_HOST/SMTP_USER/SMTP_PASS not set — email sending is disabled. ' +
    'Set these env vars (any provider: Gmail app password, SendGrid, Resend, Postmark, Mailgun, etc. all support SMTP) to enable it.');
}

async function sendMail({ to, subject, html, attachments }) {
  if (!enabled) {
    console.log(`[email] (disabled) would have sent "${subject}" to ${to}`);
    return { sent: false, reason: 'SMTP not configured' };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({ from, to, subject, html, attachments });
  return { sent: true };
}

module.exports = { sendMail, emailEnabled: enabled };
