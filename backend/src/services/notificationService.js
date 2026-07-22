require("dotenv").config();
const nodemailer = require("nodemailer");
const md = require("../data/masterData");
const db = require("../db/pool");

const MODE = process.env.NOTIFY_MODE || "mock";

let transporter = null;
if (MODE === "live") {
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id            BIGSERIAL PRIMARY KEY,
      complaint_no  TEXT,
      channel       TEXT NOT NULL DEFAULT 'internal',
      event         TEXT,
      status        TEXT,
      subject       TEXT,
      recipients    JSONB NOT NULL DEFAULT '[]'::jsonb,
      body          TEXT,
      mode          TEXT,
      actor_id      TEXT,
      remarks       TEXT,
      skipped       TEXT,
      error         TEXT,
      sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notifications_complaint_no ON notifications (complaint_no)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notifications_dedup       ON notifications (complaint_no, channel, event)`);
}

async function logNotification(entry) {
  try {
    const to = Array.isArray(entry.to) ? entry.to : (entry.to ? [entry.to] : []);
    await db.query(
      `INSERT INTO notifications
         (complaint_no, channel, event, status, subject, recipients, body, mode, actor_id, remarks, skipped, error)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
      [
        entry.complaintNo || null,
        entry.channel     || "internal",
        entry.event       || null,
        entry.status      || null,
        entry.subject     || null,
        JSON.stringify(to),
        entry.body        || null,
        entry.mode        || null,
        entry.actorId     || null,
        entry.remarks     || null,
        entry.skipped     || null,
        entry.error       || null,
      ]
    );
  } catch (err) {
    console.error("[NOTIFY] Failed to persist notification:", err.message);
  }
}

function mapRow(r) {
  return {
    complaintNo: r.complaint_no,
    channel:     r.channel,
    event:       r.event,
    status:      r.status,
    subject:     r.subject,
    to:          r.recipients || [],
    body:        r.body,
    mode:        r.mode,
    actorId:     r.actor_id,
    remarks:     r.remarks,
    skipped:     r.skipped,
    error:       r.error,
    sentAt:      r.sent_at,
  };
}

async function getAllNotifications() {
  const rows = await db.many(`SELECT * FROM notifications ORDER BY sent_at DESC, id DESC`);
  return rows.map(mapRow);
}

async function getForComplaint(complaintNo) {
  const rows = await db.many(
    `SELECT * FROM notifications WHERE complaint_no = $1 ORDER BY sent_at DESC, id DESC`,
    [complaintNo]
  );
  return rows.map(mapRow);
}

async function alreadySentCustomer(complaintNo, event) {
  const row = await db.one(
    `SELECT 1 FROM notifications
       WHERE complaint_no = $1 AND channel = 'customer' AND event = $2
         AND skipped IS NULL AND error IS NULL
       LIMIT 1`,
    [complaintNo, event]
  );
  return !!row;
}

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

function resolveRecipients(newStatus, complaint, actorUser) {
  const matrix = NOTIFICATION_MATRIX[newStatus];
  if (!matrix) return [];

  const emails = new Set();

  for (const recipientType of matrix.recipients) {
    if (recipientType === "nextActor" && matrix.nextActorRole) {

      const role = md.roles.find((r) => r.roleName === matrix.nextActorRole);
      if (role) {
        md.users
          .filter((u) => u.roleId === role.roleId && u.active)
          .forEach((u) => emails.add(u.email));
      }
    }

    if (recipientType === "reporter" && complaint.reportedBy) {

      const user = md.findUser(complaint.reportedBy);
      if (user) emails.add(user.email);
      else {
        const customer = md.findCustomer(complaint.reportedBy.replace("CUST-", ""));
        if (customer) emails.add(customer.email);
      }
    }

    if (recipientType === "allStakeholders") {

      ["R008", "R010", "R011"].forEach((roleId) => {
        md.users
          .filter((u) => u.roleId === roleId && u.active)
          .forEach((u) => emails.add(u.email));
      });
    }
  }

  if (actorUser) emails.delete(actorUser.email);

  return [...emails];
}

async function sendNotification({ complaint, newStatus, actorUser, remarks }) {
  const matrix = NOTIFICATION_MATRIX[newStatus];
  if (!matrix) return;

  const recipients = resolveRecipients(newStatus, complaint, actorUser);
  if (!recipients.length) return;

  const subject = matrix.subject(complaint);
  const body    = matrix.body(complaint, actorUser);

  await logNotification({
    complaintNo: complaint.complaintNo,
    channel:     "internal",
    status:      newStatus,
    subject,
    to:          recipients,
    body,
    mode:        MODE,
    actorId:     actorUser ? actorUser.userId : "SYSTEM",
    remarks:     remarks || null,
  });

  if (MODE === "mock") {

    console.log(`\n📧 [NOTIFY-MOCK] ${newStatus} — ${complaint.complaintNo}`);
    console.log(`   To     : ${recipients.join(", ")}`);
    console.log(`   Subject: ${subject}\n`);
    return;
  }

  if (!transporter) return;

  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

  const sendPromises = recipients.map((to) =>
    transporter.sendMail({
      from:    `"Orient Paper & Mill CCMS" <${fromAddress}>`,
      to,
      subject,
      text: body,
      html: `<pre style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${body}</pre>`,
    }).catch(async (err) => {
      console.error(`[NOTIFY] Failed to send to ${to}:`, err.message);
      await logNotification({
        complaintNo: complaint.complaintNo,
        channel:     "internal",
        status:      newStatus,
        error:       err.message,
        to:          [to],
        mode:        "live-error",
      });
    })
  );

  await Promise.all(sendPromises);
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

const CUSTOMER_EVENTS = {
  acknowledgement: {
    statusLabel: "Logged",
    subject: (c) => `[CCMS] Complaint Registered — ${c.complaintNo}`,
    intro:   "Your complaint has been successfully registered with Orient Paper & Mill.",
    message: "You can use this Complaint Number to track its status. We will keep you informed by email at every key stage.",
  },
  ts_complete: {
    statusLabel: "Technical Review Complete — Under Quality Control Review",
    subject: (c) => `[CCMS] Update on complaint ${c.complaintNo} — Technical Review Complete`,
    intro:   "Good news — our Technical Services team has completed its review of your complaint.",
    message: "Your complaint has now moved to Quality Control review. No action is needed from your side.",
  },
  qc_complete: {
    statusLabel: "Quality Review Complete — Corrective Action Underway",
    subject: (c) => `[CCMS] Update on complaint ${c.complaintNo} — Quality Review Complete`,
    intro:   "Our Quality Control team has completed its assessment of your complaint.",
    message: "Our Operations team is now documenting the corrective and preventive actions. We will update you as it progresses.",
  },
  md_review: {
    statusLabel: "Escalated for Management Approval",
    subject: (c) => `[CCMS] Update on complaint ${c.complaintNo} — Management Review`,
    intro:   "Your complaint has been escalated to our senior management for approval.",
    message: "This is a routine step for settlements of this value. We will notify you as soon as the review is complete.",
  },
  finance_processing: {
    statusLabel: "Approved — Credit Note Being Processed",
    subject: (c) => `[CCMS] Update on complaint ${c.complaintNo} — Approved, Credit Note in Progress`,
    intro:   "Your complaint has been approved and is now with our Finance team.",
    message: "A Credit Note is being raised against your invoice. You will receive a final confirmation once it has been issued.",
  },
  closed: {
    statusLabel: "Resolved & Closed",
    subject: (c) => `[CCMS] Your complaint ${c.complaintNo} has been resolved`,
    intro:   "We are pleased to inform you that your complaint has been fully resolved and closed.",
    message: "Thank you for bringing this to our attention. Should you have any further concerns, please raise a new complaint referencing this number.",
  },
};

const STATUS_TO_CUSTOMER_EVENT = {
  QC_Review:          "ts_complete",
  CAPA_Pending:       "qc_complete",
  MD_Approval:        "md_review",
  Finance_Processing: "finance_processing",
  Closed:             "closed",
};

function customerEventForStatus(newStatus) {
  return STATUS_TO_CUSTOMER_EVENT[newStatus] || null;
}

function resolveCustomerEmail(complaint) {
  const cust = complaint.customerId ? md.findCustomer(complaint.customerId) : null;
  return cust?.email || null;
}

function customerDetailLines(event, complaint) {
  const t = CUSTOMER_EVENTS[event];
  const lines = [
    ["Complaint Number", complaint.complaintNo],
    ["Customer Name",    complaint.customerName || "Valued Customer"],
    ["Invoice Number",   complaint.invoiceNumber || "—"],
    ["Complaint Date",   fmtDate(complaint.createdAt)],
    ["Current Status",   t.statusLabel],
  ];
  if (event === "closed" && complaint.creditNoteNumber) {
    lines.push(["Credit Note", complaint.creditNoteNumber]);
  }
  return lines;
}

function buildCustomerText(event, complaint) {
  const t = CUSTOMER_EVENTS[event];
  const details = customerDetailLines(event, complaint)
    .map(([k, v]) => `${k.padEnd(16)}: ${v}`)
    .join("\n");
  return [
    `Dear ${complaint.customerName || "Valued Customer"},`,
    "",
    t.intro,
    "",
    details,
    "",
    t.message,
    "",
    "This is an automated message from Orient Paper & Mill CCMS. Please do not reply to this email.",
  ].join("\n");
}

function buildCustomerHtml(event, complaint) {
  const t = CUSTOMER_EVENTS[event];
  const rows = customerDetailLines(event, complaint)
    .map(([k, v]) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#667085;white-space:nowrap">${escHtml(k)}</td>` +
      `<td style="padding:4px 0;color:#101828;font-weight:600">${escHtml(v)}</td></tr>`)
    .join("");
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#101828;font-size:14px;line-height:1.6">
  <div style="background:#0b4f6c;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
    <div style="font-size:16px;font-weight:700">Orient Paper &amp; Mill — CCMS</div>
    <div style="font-size:12px;opacity:.85">Customer Complaint Management System</div>
  </div>
  <div style="border:1px solid #e4e7ec;border-top:none;padding:20px;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px">Dear ${escHtml(complaint.customerName || "Valued Customer")},</p>
    <p style="margin:0 0 16px">${t.intro}</p>
    <table style="border-collapse:collapse;margin:0 0 16px;font-size:14px">${rows}</table>
    <p style="margin:0 0 16px">${t.message}</p>
    <p style="margin:0;color:#98a2b3;font-size:12px">This is an automated message from Orient Paper &amp; Mill CCMS. Please do not reply to this email.</p>
  </div>
</div>`.trim();
}

async function sendCustomerNotification({ complaint, event }) {
  if (!event || !CUSTOMER_EVENTS[event]) return { skipped: "unknown-event" };

  const to = resolveCustomerEmail(complaint);
  const template = CUSTOMER_EVENTS[event];

  if (!to) {
    await logNotification({
      complaintNo: complaint.complaintNo,
      channel:     "customer",
      event,
      status:      template.statusLabel,
      to:          [],
      mode:        MODE,
      skipped:     "no-customer-email",
    });
    console.log(`\n📧 [NOTIFY · CUSTOMER] ${event} — ${complaint.complaintNo}: no registered customer email, skipped.`);
    return { skipped: "no-customer-email" };
  }

  if (await alreadySentCustomer(complaint.complaintNo, event)) return { skipped: "duplicate" };

  const subject = template.subject(complaint);
  const text    = buildCustomerText(event, complaint);
  const html    = buildCustomerHtml(event, complaint);

  await logNotification({
    complaintNo: complaint.complaintNo,
    channel:     "customer",
    event,
    status:      template.statusLabel,
    subject,
    to:          [to],
    body:        text,
    mode:        MODE,
  });

  if (MODE === "mock") {
    console.log(`\n📧 [NOTIFY-MOCK · CUSTOMER] ${event} — ${complaint.complaintNo}`);
    console.log(`   To     : ${to}`);
    console.log(`   Subject: ${subject}\n`);
    return { queued: true, to };
  }

  if (!transporter) return { skipped: "no-transporter" };

  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await transporter.sendMail({
      from: `"Orient Paper & Mill CCMS" <${fromAddress}>`,
      to, subject, text, html,
    });
    return { sent: true, to };
  } catch (err) {
    console.error(`[NOTIFY · CUSTOMER] Failed to send to ${to}:`, err.message);
    await logNotification({
      complaintNo: complaint.complaintNo, channel: "customer", event,
      error: err.message, to: [to], mode: "live-error",
    });
    return { error: err.message };
  }
}

module.exports = {
  ensureTable,
  sendNotification,
  sendCustomerNotification,
  customerEventForStatus,
  resolveCustomerEmail,
  getAllNotifications,
  getForComplaint,
  NOTIFICATION_MATRIX,
  CUSTOMER_EVENTS,
  MODE,
};
