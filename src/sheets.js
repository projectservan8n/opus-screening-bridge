import { google } from 'googleapis';

let cachedAuth = null;

function getAuth() {
  if (cachedAuth) return cachedAuth;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  oauth2.setCredentials({
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  });
  cachedAuth = oauth2;
  return oauth2;
}

export async function appendApplicationRow({
  role_slug,
  role_title,
  candidate_id,
  candidate_name,
  candidate_email,
  candidate_location,
  resume_url,
  portfolio_url,
  verdict,
  score,
  summary,
  strongest_signal,
  top_concern,
  transcript_url,
}) {
  if (!process.env.OPUS_HIRES_SHEET_ID) {
    console.warn('OPUS_HIRES_SHEET_ID not set, skipping sheet append');
    return null;
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const row = [
    new Date().toISOString(),
    role_slug,
    role_title,
    candidate_id,
    candidate_name || '',
    candidate_email || '',
    candidate_location || '',
    resume_url || '',
    portfolio_url || '',
    verdict || '',
    score || '',
    summary || '',
    strongest_signal || '',
    top_concern || '',
    transcript_url || '',
    'new', // status
    '', // tony_notes
  ];

  try {
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.OPUS_HIRES_SHEET_ID,
      range: 'Applications!A:Q',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    return res.data.updates?.updatedRange || null;
  } catch (e) {
    console.error('Sheet append failed:', e.message);
    return null;
  }
}

export async function uploadTranscriptToDrive({ candidate_id, role_title, candidate_name, transcript }) {
  if (!process.env.OPUS_HIRING_DRIVE_FOLDER_ID) {
    console.warn('OPUS_HIRING_DRIVE_FOLDER_ID not set, skipping transcript upload');
    return null;
  }

  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const filename = `${(candidate_name || 'unknown').replace(/[^a-z0-9_-]/gi, '_')}__${candidate_id}.md`;

  try {
    const res = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [process.env.OPUS_HIRING_DRIVE_FOLDER_ID],
        mimeType: 'text/markdown',
      },
      media: {
        mimeType: 'text/markdown',
        body: transcript,
      },
      fields: 'id,webViewLink',
    });
    return res.data.webViewLink;
  } catch (e) {
    console.error('Drive upload failed:', e.message);
    return null;
  }
}

export function buildTranscriptMarkdown({ candidate_id, role_title, candidate_meta, messages, assessment }) {
  let md = `# Screening Transcript\n\n`;
  md += `- **Candidate:** ${candidate_meta?.name || 'Unknown'} (${candidate_id})\n`;
  md += `- **Email:** ${candidate_meta?.email || 'not provided'}\n`;
  md += `- **Location:** ${candidate_meta?.location || 'not provided'}\n`;
  md += `- **Role:** ${role_title}\n`;
  md += `- **Resume:** ${candidate_meta?.resume_url || 'not provided'}\n`;
  md += `- **Portfolio:** ${candidate_meta?.portfolio_url || 'not provided'}\n\n`;

  if (assessment) {
    md += `## Assessment\n\n`;
    md += `- **Verdict:** ${assessment.verdict}\n`;
    md += `- **Score:** ${assessment.score}/10\n\n`;
    md += `### Summary\n\n${assessment.summary}\n\n`;
    if (assessment.strongest_signals?.length) {
      md += `### Strongest signals\n\n`;
      assessment.strongest_signals.forEach((s) => (md += `- ${s}\n`));
      md += '\n';
    }
    if (assessment.concerns?.length) {
      md += `### Concerns\n\n`;
      assessment.concerns.forEach((c) => (md += `- ${c}\n`));
      md += '\n';
    }
  }

  md += `## Conversation\n\n`;
  for (const m of messages) {
    const speaker = m.role === 'assistant' ? 'Nico' : candidate_meta?.name || 'Candidate';
    md += `**${speaker}:** ${m.content}\n\n`;
  }

  return md;
}
