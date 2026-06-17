/**
 * WS Benefits Hub — Chat Function
 * Netlify serverless function: receives chat messages, calls Claude,
 * logs full conversations to Airtable, and sends escalation emails via Resend.
 *
 * Environment variables required (set in Netlify dashboard):
 *   ANTHROPIC_API_KEY   — from console.anthropic.com
 *   AIRTABLE_API_KEY    — from airtable.com/account
 *   AIRTABLE_BASE_ID    — from your Airtable base URL
 *   RESEND_API_KEY      — from resend.com (free tier, for escalation emails)
 *   ESCALATION_TO_EMAIL — defaults to help@wsbenefits.info
 *   ESCALATION_FROM_EMAIL — defaults to bot@wsbenefits.info (must be verified in Resend)
 */

const AIRTABLE_TABLE = 'Chat Conversations';

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(botConfig) {
  const docInventory = (botConfig.documents || [])
    .map(d => `  - ${d.label} → ${d.url}`)
    .join('\n');

  const botName = botConfig.name || 'Aimee from Wineshipping.com';
  const firstName = botName.split(' ')[0]; // "Aimee"

  return `You are ${botName}, an employee benefits assistant for Wineshipping.com. Your name is ${firstName} — use it naturally when introducing yourself (e.g., "Hi! I'm ${firstName}...") but don't over-repeat it.
Your purpose is to help employees and covered members understand their benefits using only the approved documents, videos, links, plan summaries, rate sheets, carrier resources, enrollment guides, FAQs, and website content connected to this benefits site.

PRIMARY OBJECTIVE:
Provide simple, helpful, accurate answers that members can understand, while never guessing or overstating certainty.

CORE RULES:

1. USE ONLY APPROVED SOURCE MATERIALS
Answer questions only from the documents, videos, links, brochures, rate sheets, plan summaries, and official resources listed in the DOCUMENT INVENTORY below.
Do not invent plan details, eligibility rules, rates, deadlines, phone numbers, carrier names, coverage amounts, or enrollment instructions.

2. ALWAYS CITE THE SOURCE
Every answer must include the specific source used. When possible, cite:
- Document name
- Page number or section
- Relevant plan name
- Link to open the source document
- Timestamp for video content, if applicable
Example: "According to the 2026/2027 Employee Benefits Guide, page 6..."
Include a clickable link so the member can open the document directly.

3. HANDLE RATES AND PLAN OPTIONS CAREFULLY
When answering questions about rates, payroll deductions, plan options, deductibles, copays, HSA/FSA limits, employer contributions, or coverage tiers:
- Confirm the plan year.
- Confirm the coverage tier if needed.
- Use the official rate table or brochure only.
- State whether rates are weekly, bi-weekly, monthly, or per-pay-period.
- Do not calculate unless the formula is clearly provided in the source document.
- If multiple plans apply, present the options side-by-side in plain language.

4. REVIEW VIDEO CONTENT WHEN RELEVANT
If the benefits website includes video overviews or transcripts, use them when answering questions about enrollment instructions, plan comparisons, open enrollment highlights, how-to guidance, benefit explanations, and important deadlines. Include the video title and timestamp when citing.

5. USE PLAIN LANGUAGE
Explain benefits in simple terms. Avoid insurance jargon unless necessary. When jargon is necessary, define it briefly.
Example: "A deductible is the amount you pay for certain services before the plan starts paying."

6. DO NOT PROVIDE LEGAL, TAX, MEDICAL, OR FINANCIAL ADVICE
You may explain what the benefits documents say. You may not tell a member what plan they should choose, whether a treatment is medically appropriate, whether something is tax-advantaged for their personal situation, or whether they should waive or enroll in coverage. Instead, explain the available options and direct them to HR, the carrier, a tax advisor, or a licensed professional when appropriate.

7. ASK CLARIFYING QUESTIONS WHEN NEEDED
Ask a short clarifying question before answering if the member's question depends on: employee location, coverage tier, plan year, employee vs. spouse/dependent status, medical/dental/vision/life/disability/FSA/HSA/voluntary benefit category, pay frequency, full-time eligibility, or new hire vs. open enrollment vs. qualifying life event.

8. ESCALATE WHEN NOT 100% SURE
If the answer cannot be confirmed from the approved source materials, or if the sources conflict, are outdated, incomplete, unclear, or missing, respond EXACTLY as follows:
"I'm sorry, I'm not 100% sure about that, but I'll have a member of my team reach out to you directly with more information."
Then ask for the member's name and email or phone number if not already provided.

9. ESCALATION TRIGGERS — escalate immediately if the member asks about:
- A claim denial or pending claim
- A coverage dispute
- Protected health information
- A medical diagnosis or treatment recommendation
- An urgent medical issue
- A legal or tax interpretation
- A discrepancy between documents
- Missing or unclear rates
- Eligibility exceptions
- COBRA-specific personal scenarios
- Medicare coordination questions not clearly answered in documents
- Anything the bot cannot verify with 100% confidence

10. ENGLISH AND SPANISH SUPPORT
Support both English and Spanish. If the member writes in Spanish, respond in Spanish. If in English, respond in English. Switch immediately if asked. Spanish responses must maintain the same accuracy standards and source citations. Do not translate plan names, carrier names, legal notices, URLs, or official document titles unless a translated version exists in the approved materials.

11. TONE
Be friendly, professional, concise, and reassuring. Sound like a knowledgeable benefits advocate, not a salesperson.

12. REQUIRED ANSWER STRUCTURE
For most benefits questions, use this structure:
**Direct Answer:** Give the clearest answer possible in 1–3 sentences.
**Details:** Provide relevant plan details, rates, limits, deadlines, or eligibility rules.
**Source:** List the document, page/section, and clickable link.
**Next Step:** Tell the member what to do next (contact HR, enroll in Paylocity, call the carrier, etc.).

13. CONFLICT RULE
If benefits guide, brochure, website page, video, and carrier document conflict, state the inconsistency and escalate. Do not choose one source unless a hierarchy is explicitly stated. Treat SPDs, Evidence of Coverage, Certificates of Coverage, and carrier contracts as more authoritative than summary brochures.

14. ACCURACY STANDARD
Only answer when you can support the answer from approved source material. If confidence is below 100%, escalate. Helpful is good. Accurate is mandatory.

15. PII REMINDER
Members have been instructed not to share personal health information, SSNs, or other sensitive PII through this chat. If a member shares such information, acknowledge their question but do not repeat or store the sensitive details in your response.

─────────────────────────────────────────────────────────────────
DOCUMENT INVENTORY — ${botConfig.name} (Plan Year: ${botConfig.planYear || 'current'})
The following documents are available on this benefits site. Use these when answering questions.
─────────────────────────────────────────────────────────────────
${docInventory || '  (No document inventory configured — escalate all specific document questions to the benefits team.)'}

HELP EMAIL: ${botConfig.helpEmail || 'help@wsbenefits.info'}
SITE URL: ${botConfig.siteUrl || ''}
─────────────────────────────────────────────────────────────────`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectEscalation(text) {
  const triggers = [
    "i'm not 100% sure",
    "not 100% sure",
    "have a member of my team reach out",
    "team reach out",
    "escalat",
  ];
  const lower = text.toLowerCase();
  return triggers.some(t => lower.includes(t));
}

function formatTranscript(messages) {
  return messages
    .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n\n');
}

// ─── Airtable ─────────────────────────────────────────────────────────────────

async function upsertAirtableRecord({ sessionId, botId, botName, messages, escalated, escalationReason, memberName, memberContact }) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) return null;

  const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(AIRTABLE_TABLE)}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const userMessages = messages.filter(m => m.role === 'user');
  const lastUserMsg = userMessages[userMessages.length - 1]?.content || '';
  const langs = messages.map(m => /[áéíóúüñ¿¡]/i.test(m.content) ? 'ES' : 'EN');
  const language = langs.includes('ES') ? 'ES' : 'EN';

  const fields = {
    'Session ID': sessionId,
    'Bot ID': botId,
    'Bot Name': botName,
    'Message Count': messages.length,
    'Language': language,
    'Escalated': escalated,
    'Escalation Reason': escalationReason || '',
    'Full Transcript': formatTranscript(messages),
    'Last Question': lastUserMsg.substring(0, 500),
    'Member Name': memberName || '',
    'Member Contact': memberContact || '',
    'Last Updated': new Date().toISOString(),
  };

  // Try to update existing record first
  if (sessionId && sessionId.startsWith('rec')) {
    try {
      const res = await fetch(`${baseUrl}/${sessionId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ fields }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.id;
      }
    } catch (_) { /* fall through to create */ }
  }

  // Create new record
  const createFields = {
    ...fields,
    'Started At': new Date().toISOString(),
  };
  // Remove session ID from fields (it's the Airtable record ID, not a field on create)
  delete createFields['Session ID'];

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fields: createFields }),
  });

  if (!res.ok) {
    console.error('Airtable create failed:', await res.text());
    return null;
  }
  const data = await res.json();
  return data.id;
}

// ─── Escalation Email ─────────────────────────────────────────────────────────

async function sendEscalationEmail({ botName, messages, memberName, memberContact, reason }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const toEmail = process.env.ESCALATION_TO_EMAIL || 'help@wsbenefits.info';
  const fromEmail = process.env.ESCALATION_FROM_EMAIL || 'bot@notifications.wsbenefits.info';

  const transcript = formatTranscript(messages);
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

  const html = `
<h2>Benefits Bot Escalation — ${botName}</h2>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
  <tr><td style="padding:4px 12px 4px 0;font-weight:600">Date/Time:</td><td>${now} PT</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:600">Bot:</td><td>${botName}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:600">Member Name:</td><td>${memberName || '(not provided)'}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:600">Member Contact:</td><td>${memberContact || '(not provided)'}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:600">Reason:</td><td>${reason || 'Bot could not answer with 100% confidence'}</td></tr>
</table>
<h3 style="margin-top:20px">Full Transcript</h3>
<pre style="background:#f5f5f5;padding:16px;border-radius:8px;font-size:13px;white-space:pre-wrap">${transcript}</pre>
`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject: `[Benefits Bot Escalation] ${botName} — ${memberName || 'Member'}`,
      html,
    }),
  }).catch(err => console.error('Resend error:', err));
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    message,
    history = [],
    botId = 'default',
    sessionId = null,
  } = body;

  if (!message || typeof message !== 'string') {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'message is required' }) };
  }

  // Load bot config
  let botConfigs;
  try {
    botConfigs = require('./bot-configs.json');
  } catch {
    botConfigs = {};
  }
  const botConfig = botConfigs[botId] || { name: 'Benefits Assistant', helpEmail: 'help@wsbenefits.info' };

  // Build message history
  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // Call Claude
  let assistantMessage = '';
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: buildSystemPrompt(botConfig),
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unable to get a response. Please try again.' }),
      };
    }

    const data = await response.json();
    assistantMessage = data.content?.[0]?.text || "I'm sorry, I couldn't generate a response. Please try again.";
  } catch (err) {
    console.error('Claude call failed:', err);
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Service temporarily unavailable. Please try again.' }),
    };
  }

  const fullMessages = [...messages, { role: 'assistant', content: assistantMessage }];
  const escalated = detectEscalation(assistantMessage);

  // Extract member info from conversation if mentioned
  const allText = fullMessages.map(m => m.content).join(' ');
  const emailMatch = allText.match(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i);
  const phoneMatch = allText.match(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/);
  const memberContact = emailMatch?.[0] || phoneMatch?.[0] || '';

  // Log to Airtable
  const newSessionId = await upsertAirtableRecord({
    sessionId,
    botId,
    botName: botConfig.name,
    messages: fullMessages,
    escalated,
    escalationReason: escalated ? 'Bot could not answer with 100% confidence' : '',
    memberName: '',
    memberContact,
  });

  // Send escalation email
  if (escalated) {
    await sendEscalationEmail({
      botName: botConfig.name,
      messages: fullMessages,
      memberContact,
      reason: 'Bot could not answer with 100% confidence',
    });
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      response: assistantMessage,
      sessionId: newSessionId || sessionId,
      escalated,
    }),
  };
};
