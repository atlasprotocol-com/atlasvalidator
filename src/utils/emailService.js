const nodemailer = require('nodemailer');
require('dotenv').config();
const config = require('../config/config.json');

// Create a transporter using Gmail
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports like 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Track last email sent time
let lastEmailSentTime = 0;

// Function to send error email
async function sendErrorEmail(error, context) {
  // Check if email is enabled in .env
  if (process.env.ENABLE_EMAIL !== 'true') {
    console.log('Email notifications are disabled');
    return;
  }

  const currentTime = Date.now();
  const emailFrequency = parseInt(process.env.EMAIL_FREQUENCY || '60000', 10); // Default to 1 minute (60000ms)
  
  // Check if enough time has passed since last email
  if (currentTime - lastEmailSentTime < emailFrequency) {
    console.log(`Email sending rate limited. Next email can be sent in ${Math.ceil((emailFrequency - (currentTime - lastEmailSentTime)) / 1000)} seconds`);
    return;
  }

  try {
    const mailOptions = {
      from: `"Atlas Validator" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_RECIPIENTS,
      subject: `Atlas Validator Error: ${context}`,
      text: `Error occurred in ${context}:\n\nContract ID: ${config.near.contractId}\nAccount ID: ${config.near.accountId}\n\nError message: ${error.message}\n\nStack trace:\n${error.stack}`,
      html: `
        <h2>Error occurred in ${context}</h2>
        <p><strong>Contract ID:</strong> ${config.near.contractId}</p>
        <p><strong>Account ID:</strong> ${config.near.accountId}</p>
        <p><strong>Error message:</strong> ${error.message}</p>
        <p><strong>Stack trace:</strong></p>
        <pre>${error.stack}</pre>
      `
    };

    await transporter.sendMail(mailOptions);
    lastEmailSentTime = currentTime;
    console.log('Error email sent successfully');
  } catch (emailError) {
    console.error('Failed to send error email:', emailError);
  }
}

module.exports = {
  sendErrorEmail
}; 