import fetch from 'node-fetch';

export async function sendTelegramAlert(message) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_TONY_CHAT_ID) {
    console.warn('Telegram not configured, skipping alert');
    return false;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_TONY_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      console.error('Telegram send failed:', res.status, body);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Telegram exception:', e.message);
    return false;
  }
}

export function formatPassAlert({ role, candidate_name, summary, strongest_signals, concerns, sheet_row, transcript_url }) {
  const template = role.telegram_pass_template || `PASS candidate for {role_title}: {candidate_name}\n\nWhy: {why_oneliner}\nStrongest signal: {strongest_signal}\nWatch out for: {watch_out}\n\nSheet: {sheet_row_url}\nTranscript: {transcript_url}`;

  return template
    .replace(/{role_title}/g, role.title)
    .replace(/{candidate_name}/g, candidate_name || 'Unknown')
    .replace(/{why_oneliner}/g, summary || '')
    .replace(/{strongest_signal}/g, (strongest_signals || [])[0] || 'none flagged')
    .replace(/{watch_out}/g, (concerns || [])[0] || 'none flagged')
    .replace(/{sheet_row_url}/g, sheet_row || 'pending')
    .replace(/{transcript_url}/g, transcript_url || 'pending');
}
