const nodemailer = require('nodemailer');

function envBoolean(value) {
  return String(value || '').toLowerCase() === 'true';
}

function getTransporter() {
  const port = Number(process.env.MAIL_PORT || 587);

  return nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port,
    secure: envBoolean(process.env.MAIL_SECURE),
    auth: process.env.MAIL_USER && process.env.MAIL_PASS
      ? {
          user: process.env.MAIL_USER,
          pass: process.env.MAIL_PASS
        }
      : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000
  });
}

async function sendQueueNotificationEmail({
  to,
  patientName,
  queueCode,
  departmentName,
  counterName,
  type
}) {
  if (!to) {
    return { skipped: true, reason: 'missing_email' };
  }

  const action = type === 'recall' ? 'recalled' : 'called';
  const subject = type === 'recall'
    ? 'Your queue has been recalled'
    : 'Your queue has been called';
  const destination = counterName || departmentName || 'the assigned service area';

  const text = [
    `Hello ${patientName || 'Patient'},`,
    '',
    `Your queue number ${queueCode} has been ${action}.`,
    `Please proceed to ${destination}.`,
    '',
    'Thank you.'
  ].join('\n');

  const transporter = getTransporter();

  return transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    to,
    subject,
    text
  });
}

module.exports = {
  sendQueueNotificationEmail
};
