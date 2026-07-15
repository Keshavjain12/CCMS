// =========================================================================
// NOTIFICATION SERVICE  —  Orient Paper & Mill CCMS
// Section 12.1 — Notification & Communication Matrix
//
// Defines exactly who gets notified at every status transition,
// by what channel (email), and what the message says.
//
// Two modes:
//   NOTIFY_MODE=mock  → logs to console + in-memory log (no real emails)
//   NOTIFY_MODE=live  → sends real emails via Nodemailer / Gmail SMTP
//
// The in-memory notification log is always written regardless of mode,
// so you can always call GET /api/notifications to see what was sent.
// =========================================================================

require("dotenv").config();
const nodemailer = require("nodemailer");
const md = require("../data/masterData");

const MODE = process.env.NOTIFY_MODE || "mock";

// ── Nodemailer transporter (only used in live mode) ───────────────────────
let transporter = null;
if (MODE === "live") {
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,   // Gmail: use App Password, not account password
    },
  });
}

// ── In-memory notification log ────────────────────────────────────────────
const notificationLog = [];

function logNotification(entry) {
  notificationLog.push({ ...entry, sentAt: new Date().toISOString() });
}

function getAllNotifications() {
  return [...notificationLog].reverse();
}

function getForComplaint(complaintNo) {
  return notificationLog.filter((n) => n.complaintNo === complaintNo).reverse();
}

// ── Communication Matrix ──────────────────────────────────────────────────
// Per status transition: who gets notified, what subject, what body template.
// "recipient" keys: nextActor | reporter | allStakeholders | mdOffice | financeTeam | kamSales
//
// nextActor     = the person/role who now needs to act
// reporter      = the customer/distributor who raised the complaint
// allStakeholders = all actors who touched this complaint so far
// ─────────────────────────────────────────────────────────────────────────
const NOTIFICATION_MATRIX = {
  Logged: {
    recipients: ["nextActor"],
    nextActorRole: "TS Head",
    subject: (c) => `[CCMS] New Complaint Logged — ${c.complaintNo}`,
    body: (c, actor) => `
Dear Technical Services Team,

A new customer complaint has been logged and requires your review.

Complaint No : ${c.complaintNo}
Title        : ${c.title}
Customer     : ${c.customerName || c.customerId}
Invoice      : ${c.invoiceNumber}
Business Line: ${c.businessLine}
Logged At    : ${c.createdAt}

Please log in to CCMS and review at your earliest convenience.

This is an automated notification from Orient Paper & Mill CCMS.
    `.trim(),
  },

  TS_Review: {
    recipients: ["nextActor"],
    nextActorRole: "TS Head",
    subject: (c) => `[CCMS] Action Required: TS Review — ${c.complaintNo}`,
    body: (c, actor) => `
Dear ${actor ? actor.name : "Technical Services Head"},

Complaint ${c.complaintNo} has been forwarded for Technical Services Head approval.

Complaint : ${c.title}
Customer  : ${c.customerName || c.customerId}
Status    : TS_Review (awaiting your approval)

Please log in to CCMS to approve, reject, or seek clarification.

Orient Paper & Mill CCMS
    `.trim(),
  },

  QC_Review: {
    recipients: ["nextActor"],
    nextActorRole: "QC Manager",
    subject: (c) => `[CCMS] Action Required: QC Review — ${c.complaintNo}`,
    body: (c, actor) => `
Dear ${actor ? actor.name : "QC Team"},

Complaint ${c.complaintNo} has cleared Technical Services review and requires Quality Control assessment.

Complaint : ${c.title}
Customer  : ${c.customerName || c.customerId}
Invoice   : ${c.invoiceNumber}
${c.sampleRequired ? "⚠️  A physical sample is required before QC approval can proceed." : ""}

Please log in to CCMS to review.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Sample_Awaited: {
    recipients: ["nextActor", "reporter"],
    nextActorRole: "QC Manager",
    subject: (c) => `[CCMS] Physical Sample Required — ${c.complaintNo}`,
    body: (c, actor) => `
Dear Team,

Complaint ${c.complaintNo} is currently awaiting receipt of a physical sample before QC review can proceed.

Complaint : ${c.title}
Customer  : ${c.customerName || c.customerId}

QC Team   : Please log the sample once received and update its status in CCMS.
Customer  : Please dispatch the physical sample at the earliest to avoid SLA breach.

Orient Paper & Mill CCMS
    `.trim(),
  },

  CAPA_Pending: {
    recipients: ["nextActor"],
    nextActorRole: "Operations Analyst",
    subject: (c) => `[CCMS] Action Required: CAPA Documentation — ${c.complaintNo}`,
    body: (c, actor) => `
Dear ${actor ? actor.name : "Operations Team"},

Complaint ${c.complaintNo} has completed QC review and requires Corrective & Preventive Action (CAPA) documentation.

Complaint : ${c.title}
Customer  : ${c.customerName || c.customerId}
${c.sampleResult ? `Sample Result: ${c.sampleResult}` : ""}

Please document the Root Cause, Corrective Action, and Preventive Action in CCMS.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Ops_Head_Approval: {
    recipients: ["nextActor"],
    nextActorRole: "Operations Head",
    subject: (c) => `[CCMS] Action Required: Operations Head Approval — ${c.complaintNo}`,
    body: (c, actor) => `
Dear ${actor ? actor.name : "Operations Head"},

CAPA has been documented for complaint ${c.complaintNo} and requires your sign-off.

Complaint : ${c.title}
Customer  : ${c.customerName || c.customerId}

Please review the CAPA details in CCMS and approve or reject.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Marketing_Review: {
    recipients: ["nextActor"],
    nextActorRole: "Product Manager",
    subject: (c) => `[CCMS] Action Required: Marketing Review — ${c.complaintNo}`,
    body: (c, actor) => `
Dear ${actor ? actor.name : "Marketing Team"},

Complaint ${c.complaintNo} has been forwarded to Marketing for commercial review.

Complaint       : ${c.title}
Customer        : ${c.customerName || c.customerId}
Business Line   : ${c.businessLine}
Settlement Value: ₹${(c.settlementValue || 0).toLocaleString("en-IN")}

Please review the proposed settlement and Sales Policy compliance in CCMS.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Marketing_Head_Approval: {
    recipients: ["nextActor"],
    nextActorRole: "Marketing Head",
    subject: (c) => `[CCMS] Action Required: Marketing Head Approval — ${c.complaintNo}`,
    body: (c, actor) => `
Dear ${actor ? actor.name : "Marketing Head"},

Complaint ${c.complaintNo} requires your final marketing approval.

Complaint           : ${c.title}
Customer            : ${c.customerName || c.customerId}
Settlement Value    : ₹${(c.settlementValue || 0).toLocaleString("en-IN")}
Policy Compliance   : ${c.policyFlag || "Not checked"}

Please log in to CCMS to approve or escalate to MD.

Orient Paper & Mill CCMS
    `.trim(),
  },

  MD_Approval: {
    recipients: ["nextActor"],
    nextActorRole: "Managing Director",
    subject: (c) => `[CCMS] MD Approval Required — ${c.complaintNo} (₹${(c.settlementValue || 0).toLocaleString("en-IN")})`,
    body: (c, actor) => `
Dear ${actor ? actor.name : "Managing Director"},

This complaint requires your approval as the settlement value exceeds the threshold or a Sales Policy breach has been flagged.

Complaint           : ${c.title}
Customer            : ${c.customerName || c.customerId}
Settlement Value    : ₹${(c.settlementValue || 0).toLocaleString("en-IN")}
Policy Status       : ${c.policyFlag || "N/A"}
${c.policyClauseBreached ? `Policy Breach       : ${c.policyClauseBreached}` : ""}

Please log in to CCMS at your earliest convenience.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Visit_Pending: {
    recipients: ["nextActor"],
    nextActorRole: "Sales/KAM",
    subject: (c) => `[CCMS] Customer Visit Required — ${c.complaintNo}`,
    body: (c, actor) => `
Dear ${actor ? actor.name : "Sales / KAM Team"},

A customer visit has been triggered for complaint ${c.complaintNo}.

Complaint           : ${c.title}
Customer            : ${c.customerName || c.customerId}
Settlement Value    : ₹${(c.settlementValue || 0).toLocaleString("en-IN")}
Trigger Reason      : ${c.isKeyAccount ? "Key Account" : "High-value settlement"}

Please schedule and complete the visit, then update the outcome in CCMS before Finance can proceed.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Finance_Processing: {
    recipients: ["nextActor"],
    nextActorRole: "Finance Officer",
    subject: (c) => `[CCMS] Action Required: Raise Credit Note in SAP — ${c.complaintNo}`,
    body: (c, actor) => `
Dear ${actor ? actor.name : "Finance Team"},

Complaint ${c.complaintNo} has been fully approved and is ready for Credit Note issuance in SAP.

Complaint           : ${c.title}
Customer            : ${c.customerName || c.customerId}
Settlement Value    : ₹${(c.settlementValue || 0).toLocaleString("en-IN")}
Invoice             : ${c.invoiceNumber}

Please raise the Credit Note in SAP and update the CN number in CCMS to close the complaint.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Closed: {
    recipients: ["reporter", "allStakeholders"],
    subject: (c) => `[CCMS] Complaint Resolved & Closed — ${c.complaintNo}`,
    body: (c, actor) => `
Dear Team,

Complaint ${c.complaintNo} has been fully resolved and closed.

Complaint           : ${c.title}
Customer            : ${c.customerName || c.customerId}
Settlement Value    : ₹${(c.settlementValue || 0).toLocaleString("en-IN")}
Credit Note         : ${c.creditNoteNumber || "Issued in SAP"}
Closed At           : ${c.closedAt || new Date().toISOString()}

Thank you for your prompt action in resolving this complaint.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Clarification_Sought: {
    recipients: ["reporter"],
    subject: (c) => `[CCMS] Clarification Required — ${c.complaintNo}`,
    body: (c, actor) => `
Dear Customer,

The processing team requires additional clarification for your complaint.

Complaint           : ${c.title}
Complaint No        : ${c.complaintNo}
Requested By        : ${actor ? actor.name : "CCMS Team"}

Please respond with the required information at your earliest to avoid delays.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Rejected: {
    recipients: ["reporter"],
    subject: (c) => `[CCMS] Complaint Returned for Revision — ${c.complaintNo}`,
    body: (c, actor) => `
Dear Team,

Complaint ${c.complaintNo} has been returned for revision at the previous stage.

Complaint           : ${c.title}
Returned By         : ${actor ? actor.name : "Reviewer"}

Please review the remarks and take necessary action in CCMS.

Orient Paper & Mill CCMS
    `.trim(),
  },

  Auto_Closed: {
    recipients: ["reporter", "allStakeholders"],
    subject: (c) => `[CCMS] Complaint Auto-Closed (SLA Breach) — ${c.complaintNo}`,
    body: (c, actor) => `
Dear Team,

Complaint ${c.complaintNo} has been auto-closed due to no response within the allowed SLA window.

Complaint           : ${c.title}
Customer            : ${c.customerName || c.customerId}

If you believe this was closed in error, please raise a new complaint or contact the CCMS admin.

Orient Paper & Mill CCMS
    `.trim(),
  },
};

// ── Resolve recipients for a given status + complaint ─────────────────────
function resolveRecipients(newStatus, complaint, actorUser) {
  const matrix = NOTIFICATION_MATRIX[newStatus];
  if (!matrix) return [];

  const emails = new Set();

  for (const recipientType of matrix.recipients) {
    if (recipientType === "nextActor" && matrix.nextActorRole) {
      // Find users with the matching role name
      const role = md.roles.find((r) => r.roleName === matrix.nextActorRole);
      if (role) {
        md.users
          .filter((u) => u.roleId === role.roleId && u.active)
          .forEach((u) => emails.add(u.email));
      }
    }

    if (recipientType === "reporter" && complaint.reportedBy) {
      // Try to find reporter in users first, then customers
      const user = md.findUser(complaint.reportedBy);
      if (user) emails.add(user.email);
      else {
        const customer = md.findCustomer(complaint.reportedBy.replace("CUST-", ""));
        if (customer) emails.add(customer.email);
      }
    }

    if (recipientType === "allStakeholders") {
      // Notify all users who appeared in the audit trail
      // For simplicity, notify all active internal users (Marketing Head + KAM always on closure)
      ["R008", "R010", "R011"].forEach((roleId) => {
        md.users
          .filter((u) => u.roleId === roleId && u.active)
          .forEach((u) => emails.add(u.email));
      });
    }
  }

  // Always exclude the actor who just performed the action from the notification
  if (actorUser) emails.delete(actorUser.email);

  return [...emails];
}

// ── Send notification (main entry point) ─────────────────────────────────
async function sendNotification({ complaint, newStatus, actorUser, remarks }) {
  const matrix = NOTIFICATION_MATRIX[newStatus];
  if (!matrix) return; // No notification defined for this status

  const recipients = resolveRecipients(newStatus, complaint, actorUser);
  if (!recipients.length) return;

  const subject = matrix.subject(complaint);
  const body    = matrix.body(complaint, actorUser);

  // Always write to in-memory log
  logNotification({
    complaintNo: complaint.complaintNo,
    status:      newStatus,
    subject,
    to:          recipients,
    body,
    mode:        MODE,
    actorId:     actorUser ? actorUser.userId : "SYSTEM",
    remarks:     remarks || null,
  });

  if (MODE === "mock") {
    // Console log for development visibility
    console.log(`\n📧 [NOTIFY-MOCK] ${newStatus} — ${complaint.complaintNo}`);
    console.log(`   To     : ${recipients.join(", ")}`);
    console.log(`   Subject: ${subject}\n`);
    return;
  }

  // Live mode — send real emails
  if (!transporter) return;

  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

  const sendPromises = recipients.map((to) =>
    transporter.sendMail({
      from:    `"Orient Paper & Mill CCMS" <${fromAddress}>`,
      to,
      subject,
      text: body,
      html: `<pre style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${body}</pre>`,
    }).catch((err) => {
      console.error(`[NOTIFY] Failed to send to ${to}:`, err.message);
      logNotification({
        complaintNo: complaint.complaintNo,
        status:      newStatus,
        error:       err.message,
        to:          [to],
        mode:        "live-error",
      });
    })
  );

  await Promise.all(sendPromises);
}

module.exports = {
  sendNotification,
  getAllNotifications,
  getForComplaint,
  NOTIFICATION_MATRIX,
  MODE,
};
