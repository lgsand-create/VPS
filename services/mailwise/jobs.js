/**
 * Jobbprocessor — hanterar mw_jobs-kö
 *
 * Plockar väntande jobb och kör LLM-analys via Ollama.
 * Stödjer: analyze_message, analyze_thread, extract_faq, batch_analyze
 */

import pool from '../db/connection.js';
import { analyzeMessage, analyzeThread, extractFAQs, generateDraftReply, batchAnalyze } from './llm.js';

/**
 * Skapa ett nytt jobb
 */
export async function createJob(type, mailboxId, inputData = {}) {
  const [result] = await pool.execute(
    `INSERT INTO mw_jobs (mailbox_id, type, status, input_data) VALUES (?, ?, 'pending', ?)`,
    [mailboxId, type, JSON.stringify(inputData)]
  );
  return result.insertId;
}

/**
 * Bearbeta nästa väntande jobb
 *
 * Returnerar true om ett jobb bearbetades, false om kön är tom
 */
export async function processNextJob() {
  // Hämta äldsta pending-jobb (atomärt med FOR UPDATE)
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [jobs] = await conn.execute(
      `SELECT * FROM mw_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
    );

    if (jobs.length === 0) {
      await conn.rollback();
      return false;
    }

    const job = jobs[0];

    // Markera som processing
    await conn.execute(
      `UPDATE mw_jobs SET status = 'processing', started_at = NOW() WHERE id = ?`,
      [job.id]
    );
    await conn.commit();

    // Bearbeta utanför transaktionen
    try {
      switch (job.type) {
        case 'analyze_message':
          await processAnalyzeMessage(job);
          break;
        case 'analyze_thread':
          await processAnalyzeThread(job);
          break;
        case 'extract_faq':
          await processExtractFAQ(job);
          break;
        case 'batch_analyze':
          await processBatchAnalyze(job);
          break;
        case 'label_sync':
          await processLabelSync(job);
          break;
        default:
          throw new Error(`Okänd jobbtyp: ${job.type}`);
      }

      await pool.execute(
        `UPDATE mw_jobs SET status = 'completed', progress = 100, finished_at = NOW() WHERE id = ?`,
        [job.id]
      );
    } catch (err) {
      console.error(`  [MAILWISE] Jobb ${job.id} (${job.type}) misslyckades: ${err.message}`);
      await pool.execute(
        `UPDATE mw_jobs SET status = 'failed', error_message = ?, finished_at = NOW() WHERE id = ?`,
        [err.message.slice(0, 1000), job.id]
      );
      await logJobProgress(job.id, 'error', err.message);
    }

    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Analysera enskilt meddelande
 */
async function processAnalyzeMessage(job) {
  const input = JSON.parse(job.input_data || '{}');
  const messageIds = input.messageIds || [];

  for (const msgId of messageIds) {
    const [msgs] = await pool.execute(
      'SELECT id, subject, from_address, body_text, snippet, mailbox_id FROM mw_messages WHERE id = ?',
      [msgId]
    );
    if (msgs.length === 0) continue;

    const msg = msgs[0];
    await logJobProgress(job.id, 'info', `Analyserar meddelande ${msg.subject || msg.id}`);

    const analysis = await analyzeMessage(
      msg.body_text || msg.snippet,
      msg.subject,
      msg.from_address
    );

    // Uppdatera meddelandet
    await pool.execute(
      `UPDATE mw_messages SET category = ?, priority = ?, sentiment = ?, summary = ?, analyzed_at = NOW()
       WHERE id = ?`,
      [analysis.category, analysis.priority, analysis.sentiment, analysis.summary, msgId]
    );

    // Generera svarsförslag om begärt
    if (input.generateDraft) {
      const draft = await generateDraftReply(msg, null, input.tone || 'friendly');
      await pool.execute(
        `INSERT INTO mw_draft_replies (mailbox_id, message_id, draft_text, tone, confidence, job_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [msg.mailbox_id, msgId, draft.draftText, input.tone || 'friendly', draft.confidence, job.id]
      );
    }
  }
}

/**
 * Analysera tråd
 */
async function processAnalyzeThread(job) {
  const input = JSON.parse(job.input_data || '{}');
  const threadId = input.threadId;
  const mailboxId = input.mailboxId || job.mailbox_id;

  if (!threadId) throw new Error('threadId saknas i input_data');

  const [messages] = await pool.execute(
    `SELECT id, from_address, date, body_text, snippet
     FROM mw_messages WHERE mailbox_id = ? AND thread_id = ? ORDER BY date ASC`,
    [mailboxId, threadId]
  );

  if (messages.length === 0) throw new Error('Inga meddelanden i tråden');

  await logJobProgress(job.id, 'info', `Analyserar tråd med ${messages.length} meddelanden`);

  const analysis = await analyzeThread(messages);

  await pool.execute(
    `UPDATE mw_threads SET thread_summary = ?, resolved = ?, analyzed_at = NOW()
     WHERE mailbox_id = ? AND gmail_thread_id = ?`,
    [analysis.summary, analysis.resolved, mailboxId, threadId]
  );
}

/**
 * Extrahera FAQ från tråd(ar)
 */
async function processExtractFAQ(job) {
  const input = JSON.parse(job.input_data || '{}');
  const threadIds = input.threadIds || [];
  const mailboxId = input.mailboxId || job.mailbox_id;

  let totalExtracted = 0;

  for (const threadId of threadIds) {
    const [messages] = await pool.execute(
      `SELECT id, gmail_id, from_address, body_text, snippet
       FROM mw_messages WHERE mailbox_id = ? AND thread_id = ? ORDER BY date ASC`,
      [mailboxId, threadId]
    );

    if (messages.length < 2) continue;  // Behöver minst fråga + svar

    await logJobProgress(job.id, 'info', `Extraherar FAQ från tråd ${threadId} (${messages.length} meddelanden)`);

    const faqs = await extractFAQs(messages);

    for (const faq of faqs) {
      await pool.execute(
        `INSERT INTO mw_faqs (mailbox_id, question, answer, source_thread_id, source_messages, confidence, tags, job_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mailboxId, faq.question, faq.answer, threadId,
          JSON.stringify(messages.map(m => m.gmail_id)),
          faq.confidence, JSON.stringify(faq.tags), job.id,
        ]
      );
      totalExtracted++;
    }

    // Uppdatera progress
    const idx = threadIds.indexOf(threadId) + 1;
    const progress = Math.round((idx / threadIds.length) * 100);
    await pool.execute(
      'UPDATE mw_jobs SET progress = ?, processed_items = ? WHERE id = ?',
      [progress, idx, job.id]
    );
  }

  await pool.execute(
    'UPDATE mw_jobs SET result_data = ? WHERE id = ?',
    [JSON.stringify({ totalExtracted }), job.id]
  );
}

/**
 * Batchanalys av flera meddelanden
 */
async function processBatchAnalyze(job) {
  const input = JSON.parse(job.input_data || '{}');
  const messageIds = input.messageIds || [];

  if (messageIds.length === 0) return;

  // Hämta meddelanden
  const placeholders = messageIds.map(() => '?').join(',');
  const [messages] = await pool.execute(
    `SELECT id, subject, from_address, body_text, snippet, mailbox_id
     FROM mw_messages WHERE id IN (${placeholders})`,
    messageIds
  );

  await logJobProgress(job.id, 'info', `Batch-analyserar ${messages.length} meddelanden`);

  // Uppdatera total_items
  await pool.execute('UPDATE mw_jobs SET total_items = ? WHERE id = ?', [messages.length, job.id]);

  const results = await batchAnalyze(messages, async (done, total) => {
    const progress = Math.round((done / total) * 100);
    await pool.execute(
      'UPDATE mw_jobs SET progress = ?, processed_items = ? WHERE id = ?',
      [progress, done, job.id]
    );
  });

  // Uppdatera meddelanden med analysresultat
  let updated = 0;
  for (const result of results) {
    if (result.error) continue;
    await pool.execute(
      `UPDATE mw_messages SET category = ?, priority = ?, sentiment = ?, summary = ?, analyzed_at = NOW()
       WHERE id = ?`,
      [result.category, result.priority, result.sentiment, result.summary, result.messageId]
    );
    updated++;
  }

  await pool.execute(
    'UPDATE mw_jobs SET result_data = ? WHERE id = ?',
    [JSON.stringify({ analyzed: updated, errors: results.filter(r => r.error).length }), job.id]
  );
}

/**
 * Synka etiketter
 */
async function processLabelSync(job) {
  const { syncLabels } = await import('./sync.js');
  const mailboxId = job.mailbox_id;
  if (!mailboxId) throw new Error('mailbox_id saknas');
  const count = await syncLabels(mailboxId);
  await pool.execute(
    'UPDATE mw_jobs SET result_data = ? WHERE id = ?',
    [JSON.stringify({ labelsSynced: count }), job.id]
  );
}

/**
 * Logga jobbprogress
 */
export async function logJobProgress(jobId, level, message, data = null) {
  try {
    await pool.execute(
      'INSERT INTO mw_job_logs (job_id, level, message, data) VALUES (?, ?, ?, ?)',
      [jobId, level, message.slice(0, 1000), data ? JSON.stringify(data) : null]
    );
  } catch {
    // Logga tyst — ska inte krascha jobbprocessorn
  }
}
