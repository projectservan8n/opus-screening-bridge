// Webhook fire-out to Tarsee. The actual brain (Nico) runs on Tarsee.
// Bridge fires this, Tarsee responds asynchronously by POSTing back to /nico-reply.
import fetch from 'node-fetch';

const TARSEE_WEBHOOK_URL = process.env.TARSEE_WEBHOOK_URL;
const TARSEE_WEBHOOK_TOKEN = process.env.TARSEE_WEBHOOK_TOKEN;

export async function fireTarseeScreening({ candidateId, role, messages, internalState, replyUrl, completeUrl }) {
  if (!TARSEE_WEBHOOK_URL) {
    console.error('TARSEE_WEBHOOK_URL not set, cannot fire screening webhook');
    throw new Error('TARSEE_WEBHOOK_URL not configured');
  }

  const payload = {
    event: 'screening_message',
    candidate_id: candidateId,
    role_slug: role.slug,
    role_title: role.title,
    role_spec: role,
    message_history: messages,
    latest_message: messages[messages.length - 1]?.content || '',
    internal_state: internalState || {},
    reply_url: replyUrl,
    complete_url: completeUrl,
    bridge_origin: process.env.RAILWAY_PUBLIC_DOMAIN || 'opus-screening-bridge.up.railway.app',
  };

  const headers = { 'Content-Type': 'application/json' };
  if (TARSEE_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${TARSEE_WEBHOOK_TOKEN}`;

  const res = await fetch(TARSEE_WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tarsee webhook failed: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return { fired: true, status: res.status };
}

export function getInitialMessage(role) {
  return role.screening_protocol.intro_message;
}
