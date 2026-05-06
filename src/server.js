import express from 'express';
import cors from 'cors';
import { q } from './db.js';
import { getRole, listRoles } from './roles.js';
import { generateNicoReply, getInitialMessage } from './nico.js';
import {
  appendApplicationRow,
  uploadTranscriptToDrive,
  buildTranscriptMarkdown,
} from './sheets.js';
import { sendTelegramAlert, formatPassAlert } from './telegram.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('CORS: origin not allowed'));
      }
    },
  })
);

// Health
app.get('/health', async (_req, res) => {
  let dbOk = false;
  try {
    await q('SELECT 1');
    dbOk = true;
  } catch {}
  res.json({ ok: true, db: dbOk ? 'connected' : 'down', service: 'opus-screening-bridge' });
});

// List open roles
app.get('/api/roles', (_req, res) => {
  const roles = listRoles({ statusFilter: ['open'] }).map((r) => ({
    slug: r.slug,
    title: r.title,
    type: r.type,
    rate: r.rate,
    location: r.location,
    commitment: r.commitment,
    summary: r.summary,
    tags: r.tags || [],
    status: r.status,
  }));
  res.json({ roles });
});

// Get one role spec (full detail)
app.get('/api/roles/:slug', (req, res) => {
  const role = getRole(req.params.slug);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  res.json({
    slug: role.slug,
    title: role.title,
    type: role.type,
    rate: role.rate,
    location: role.location,
    commitment: role.commitment,
    status: role.status,
    summary: role.summary,
    intro_paragraphs: role.intro_paragraphs,
    responsibilities: role.responsibilities,
    requirements: role.requirements,
    package: role.package,
    tags: role.tags || [],
    estimated_minutes: role.screening_protocol?.estimated_minutes || 15,
  });
});

// Start or resume a screening session
app.post('/api/screening/:slug/start', async (req, res) => {
  const role = getRole(req.params.slug);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.status !== 'open') return res.status(400).json({ error: 'Role not open' });

  const candidateId = req.body.candidate_id || generateCandidateId();

  // Check if exists
  const existing = await q(
    'SELECT candidate_id, status FROM candidates WHERE candidate_id = $1',
    [candidateId]
  );

  if (existing.rows.length === 0) {
    // New candidate
    await q(
      `INSERT INTO candidates (candidate_id, role_slug, current_phase) VALUES ($1, $2, $3)`,
      [candidateId, role.slug, 'warm_up']
    );

    const introMessage = getInitialMessage(role);
    await q(
      `INSERT INTO messages (candidate_id, role, content, phase) VALUES ($1, 'assistant', $2, 'warm_up')`,
      [candidateId, introMessage]
    );

    return res.json({
      candidate_id: candidateId,
      messages: [{ role: 'assistant', content: introMessage }],
      completed: false,
    });
  }

  // Existing candidate, return their conversation
  const msgs = await q(
    `SELECT role, content FROM messages WHERE candidate_id = $1 ORDER BY created_at ASC`,
    [candidateId]
  );
  const cand = existing.rows[0];

  return res.json({
    candidate_id: candidateId,
    messages: msgs.rows,
    completed: cand.status === 'completed',
  });
});

// Receive a candidate message, generate Nico's reply synchronously
app.post('/api/screening/:slug/:candidateId/message', async (req, res) => {
  const role = getRole(req.params.slug);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  const { candidateId } = req.params;
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }

  // Verify candidate exists
  const candRes = await q(
    'SELECT * FROM candidates WHERE candidate_id = $1 AND role_slug = $2',
    [candidateId, role.slug]
  );
  if (candRes.rows.length === 0) {
    return res.status(404).json({ error: 'Candidate session not found' });
  }
  const candidate = candRes.rows[0];

  if (candidate.status === 'completed') {
    return res.status(400).json({ error: 'Screening already completed' });
  }

  // Append user message
  await q(
    `INSERT INTO messages (candidate_id, role, content, phase) VALUES ($1, 'user', $2, $3)`,
    [candidateId, message, candidate.current_phase]
  );

  // Pull conversation history
  const history = await q(
    `SELECT role, content FROM messages WHERE candidate_id = $1 ORDER BY created_at ASC`,
    [candidateId]
  );

  // Generate Nico's reply
  let result;
  try {
    result = await generateNicoReply({
      role,
      messages: history.rows,
      internalState: candidate.internal_state || {},
    });
  } catch (e) {
    console.error('Nico generation failed:', e.message);
    return res.status(500).json({
      error: 'Generation failed',
      reply: "Hold on a sec, I'm hitting a hiccup on my end. Try sending that again?",
    });
  }

  const { reply, internalUpdate, finalAssessment } = result;

  // Update internal state
  if (internalUpdate) {
    const newState = { ...(candidate.internal_state || {}), ...internalUpdate };
    const meta = internalUpdate.candidate_meta_updates || {};
    await q(
      `UPDATE candidates SET
         internal_state = $1,
         current_phase = COALESCE($2, current_phase),
         candidate_name = COALESCE($3, candidate_name),
         candidate_email = COALESCE($4, candidate_email),
         candidate_location = COALESCE($5, candidate_location),
         resume_url = COALESCE($6, resume_url),
         portfolio_url = COALESCE($7, portfolio_url),
         updated_at = NOW()
       WHERE candidate_id = $8`,
      [
        newState,
        internalUpdate.current_phase || null,
        meta.name || null,
        meta.email || null,
        meta.location || null,
        meta.resume_url || null,
        meta.portfolio_url || null,
        candidateId,
      ]
    );
  }

  // Save Nico's reply
  await q(
    `INSERT INTO messages (candidate_id, role, content, phase) VALUES ($1, 'assistant', $2, $3)`,
    [candidateId, reply, internalUpdate?.current_phase || candidate.current_phase]
  );

  let completed = false;

  // Handle final assessment
  if (finalAssessment) {
    completed = true;
    await finalizeScreening({
      candidateId,
      role,
      assessment: finalAssessment,
      messages: [...history.rows, { role: 'assistant', content: reply }],
    });
  }

  res.json({ reply, completed });
});

// Get conversation history (for resume)
app.get('/api/screening/:slug/:candidateId/messages', async (req, res) => {
  const candRes = await q(
    'SELECT status FROM candidates WHERE candidate_id = $1 AND role_slug = $2',
    [req.params.candidateId, req.params.slug]
  );
  if (candRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });

  const msgs = await q(
    `SELECT role, content FROM messages WHERE candidate_id = $1 ORDER BY created_at ASC`,
    [req.params.candidateId]
  );

  res.json({
    messages: msgs.rows,
    completed: candRes.rows[0].status === 'completed',
  });
});

async function finalizeScreening({ candidateId, role, assessment, messages }) {
  // Update candidate row
  await q(
    `UPDATE candidates SET
       status = 'completed',
       verdict = $1,
       score = $2,
       summary = $3,
       strongest_signal = $4,
       top_concern = $5,
       candidate_name = COALESCE($6, candidate_name),
       candidate_email = COALESCE($7, candidate_email),
       candidate_location = COALESCE($8, candidate_location),
       resume_url = COALESCE($9, resume_url),
       portfolio_url = COALESCE($10, portfolio_url),
       completed_at = NOW(),
       updated_at = NOW()
     WHERE candidate_id = $11`,
    [
      assessment.verdict,
      assessment.score,
      assessment.summary,
      (assessment.strongest_signals || [])[0] || null,
      (assessment.concerns || [])[0] || null,
      assessment.candidate_name || null,
      assessment.candidate_email || null,
      assessment.candidate_location || null,
      assessment.resume_url || null,
      assessment.portfolio_url || null,
      candidateId,
    ]
  );

  // Build + upload transcript to Drive
  const transcript = buildTranscriptMarkdown({
    candidate_id: candidateId,
    role_title: role.title,
    candidate_meta: {
      name: assessment.candidate_name,
      email: assessment.candidate_email,
      location: assessment.candidate_location,
      resume_url: assessment.resume_url,
      portfolio_url: assessment.portfolio_url,
    },
    messages,
    assessment,
  });
  const transcriptUrl = await uploadTranscriptToDrive({
    candidate_id: candidateId,
    role_title: role.title,
    candidate_name: assessment.candidate_name,
    transcript,
  });

  // Append to sheet
  const sheetRange = await appendApplicationRow({
    role_slug: role.slug,
    role_title: role.title,
    candidate_id: candidateId,
    candidate_name: assessment.candidate_name,
    candidate_email: assessment.candidate_email,
    candidate_location: assessment.candidate_location,
    resume_url: assessment.resume_url,
    portfolio_url: assessment.portfolio_url,
    verdict: assessment.verdict,
    score: assessment.score,
    summary: assessment.summary,
    strongest_signal: (assessment.strongest_signals || [])[0],
    top_concern: (assessment.concerns || [])[0],
    transcript_url: transcriptUrl || '',
  });

  // Telegram alert on PASS
  if (assessment.verdict === 'PASS') {
    const alert = formatPassAlert({
      role,
      candidate_name: assessment.candidate_name,
      summary: assessment.summary,
      strongest_signals: assessment.strongest_signals,
      concerns: assessment.concerns,
      sheet_row: sheetRange ? `https://docs.google.com/spreadsheets/d/${process.env.OPUS_HIRES_SHEET_ID}/edit` : 'pending',
      transcript_url: transcriptUrl || 'pending',
    });
    await sendTelegramAlert(alert);
  }

  console.log(`[screening complete] ${candidateId} | ${role.slug} | ${assessment.verdict} (${assessment.score})`);
}

function generateCandidateId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `cand_${t}_${r}`;
}

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`opus-screening-bridge listening on :${PORT}`);
});
