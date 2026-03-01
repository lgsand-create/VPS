/**
 * Gmail-synkningslogik — initial och inkrementell synkning
 *
 * Hämtar meddelanden från Gmail API och sparar i mw_messages/mw_threads.
 * Stödjer både full initial synk och inkrementell delta-synk via History API.
 */

import pool from '../db/connection.js';
import { fetchMessages, fetchMessage, fetchThread, fetchHistory, fetchLabels, fetchProfile } from './gmail.js';

/**
 * Initial synk — hämta meddelanden från de senaste N dagarna
 *
 * Sparar progress i mw_mailboxes (sync_progress) så dashboarden
 * kan visa "147 / 2500 meddelanden synkade".
 */
export async function initialSync(mailboxId, daysBack = 0) {
  const query = daysBack > 0 ? `after:${daysAgo(daysBack)}` : '';
  let pageToken = null;
  let totalSynced = 0;
  let totalEstimated = 0;
  let errors = 0;

  console.log(`  [MAILWISE] Initial synk brevlåda ${mailboxId}${daysBack > 0 ? ` (${daysBack} dagar)` : ' (alla meddelanden)'}`);

  // Hämta faktiskt antal meddelanden från profilen
  let profile = await fetchProfile(mailboxId);
  totalEstimated = profile.messagesTotal || 0;

  // Första anropet
  const firstPage = await fetchMessages(mailboxId, query, 50);
  let messageIds = firstPage.messages || [];
  pageToken = firstPage.nextPageToken || null;

  await updateSyncProgress(mailboxId, 0, totalEstimated);
  console.log(`  [MAILWISE] Brevlåda ${mailboxId}: ${totalEstimated} meddelanden att synka`);

  // Bearbeta alla sidor
  let page = 1;
  while (true) {
    for (const { id: gmailId } of messageIds) {
      try {
        const fullMsg = await fetchMessage(mailboxId, gmailId, 'full');
        await storeMessage(mailboxId, fullMsg);
        totalSynced++;

        // Uppdatera progress var 25:e meddelande
        if (totalSynced % 25 === 0) {
          await updateSyncProgress(mailboxId, totalSynced, totalEstimated);
          console.log(`  [MAILWISE] Brevlåda ${mailboxId}: ${totalSynced} / ~${totalEstimated} synkade`);
        }
      } catch (err) {
        errors++;
        if (errors > 50) {
          console.error(`  [MAILWISE] För många fel vid synk — avbryter`);
          break;
        }
      }
    }

    if (!pageToken || errors > 50) break;

    // Hämta nästa sida
    await sleep(500);
    const nextPage = await fetchMessages(mailboxId, query, 50, pageToken);
    messageIds = nextPage.messages || [];
    pageToken = nextPage.nextPageToken || null;
    page++;
  }

  // Rensa progress
  await updateSyncProgress(mailboxId, totalSynced, totalSynced);

  // Hämta history ID för framtida inkrementell synk
  profile = await fetchProfile(mailboxId);

  console.log(`  [MAILWISE] Initial synk klar: ${totalSynced} meddelanden, ${errors} fel`);
  return { synced: totalSynced, errors, historyId: profile.historyId };
}

/**
 * Uppdatera synkprogress i DB (för dashboard-feedback)
 */
async function updateSyncProgress(mailboxId, synced, total) {
  await pool.execute(
    `UPDATE mw_mailboxes SET sync_progress = ?, sync_total = ? WHERE id = ?`,
    [synced, total, mailboxId]
  ).catch(() => {});
}

/**
 * Inkrementell synk via Gmail History API
 */
export async function incrementalSync(mailboxId, historyId) {
  let added = 0;
  let modified = 0;
  let newHistoryId = historyId;
  let pageToken = null;

  try {
    do {
      const historyResult = await fetchHistory(mailboxId, historyId);
      newHistoryId = historyResult.historyId || historyId;
      const historyRecords = historyResult.history || [];

      for (const record of historyRecords) {
        // Nya meddelanden
        if (record.messagesAdded) {
          for (const { message } of record.messagesAdded) {
            try {
              const fullMsg = await fetchMessage(mailboxId, message.id, 'full');
              await storeMessage(mailboxId, fullMsg);
              added++;
            } catch {
              // Meddelandet kanske redan raderats
            }
          }
        }

        // Etikettändringar
        if (record.labelsAdded || record.labelsRemoved) {
          const msgs = [
            ...(record.labelsAdded || []).map(l => l.message),
            ...(record.labelsRemoved || []).map(l => l.message),
          ];
          for (const message of msgs) {
            try {
              const fullMsg = await fetchMessage(mailboxId, message.id, 'metadata');
              await updateMessageLabels(mailboxId, message.id, fullMsg.labelIds || []);
              modified++;
            } catch {
              // Ignorera
            }
          }
        }
      }

      pageToken = historyResult.nextPageToken || null;
    } while (pageToken);
  } catch (err) {
    // History ID kan vara ogiltigt (för gammal) — kräver full omsynk
    if (err.message.includes('404') || err.message.includes('historyId')) {
      console.warn(`  [MAILWISE] History ID ogiltigt — kräver full omsynk`);
      return { added: 0, modified: 0, newHistoryId: null, needsFullSync: true };
    }
    throw err;
  }

  return { added, modified, newHistoryId, needsFullSync: false };
}

/**
 * Synka Gmail-etiketter till mw_labels
 */
export async function syncLabels(mailboxId) {
  const labelData = await fetchLabels(mailboxId);
  const labels = labelData.labels || [];

  for (const label of labels) {
    const type = label.type === 'system' ? 'system' : 'user';
    const count = label.messagesTotal || 0;

    await pool.execute(`
      INSERT INTO mw_labels (mailbox_id, gmail_label_id, name, type, message_count, synced_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        message_count = VALUES(message_count),
        synced_at = NOW()
    `, [mailboxId, label.id, label.name, type, count]);
  }

  return labels.length;
}

/**
 * Spara/uppdatera ett meddelande i DB + uppdatera tråd
 */
export async function storeMessage(mailboxId, gmailMessage) {
  const parsed = parseGmailMessage(gmailMessage);

  await pool.execute(`
    INSERT INTO mw_messages
      (mailbox_id, gmail_id, thread_id, subject, from_address, from_name,
       to_addresses, cc_addresses, date, snippet, body_text, body_html,
       labels, is_read, is_starred, has_attachments, size_estimate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      labels = VALUES(labels),
      is_read = VALUES(is_read),
      is_starred = VALUES(is_starred),
      snippet = VALUES(snippet)
  `, [
    mailboxId,
    parsed.gmailId,
    parsed.threadId,
    parsed.subject,
    parsed.fromAddress,
    parsed.fromName,
    JSON.stringify(parsed.toAddresses),
    JSON.stringify(parsed.ccAddresses),
    parsed.date,
    parsed.snippet,
    parsed.bodyText,
    parsed.bodyHtml,
    JSON.stringify(parsed.labels),
    parsed.isRead,
    parsed.isStarred,
    parsed.hasAttachments,
    parsed.sizeEstimate,
  ]);

  // Uppdatera tråd
  if (parsed.threadId) {
    await upsertThread(mailboxId, parsed.threadId, parsed);
  }
}

/**
 * Uppdatera etiketter för ett meddelande
 */
async function updateMessageLabels(mailboxId, gmailId, labelIds) {
  const isRead = !labelIds.includes('UNREAD');
  const isStarred = labelIds.includes('STARRED');

  await pool.execute(
    `UPDATE mw_messages SET labels = ?, is_read = ?, is_starred = ?
     WHERE mailbox_id = ? AND gmail_id = ?`,
    [JSON.stringify(labelIds), isRead, isStarred, mailboxId, gmailId]
  );
}

/**
 * Skapa/uppdatera tråd i mw_threads
 */
async function upsertThread(mailboxId, gmailThreadId, messageParsed) {
  // Räkna meddelanden i tråden
  const [countResult] = await pool.execute(
    'SELECT COUNT(*) as cnt FROM mw_messages WHERE mailbox_id = ? AND thread_id = ?',
    [mailboxId, gmailThreadId]
  );
  const messageCount = countResult[0].cnt;

  // Samla deltagare
  const [participants] = await pool.execute(
    `SELECT DISTINCT from_address FROM mw_messages
     WHERE mailbox_id = ? AND thread_id = ? AND from_address IS NOT NULL`,
    [mailboxId, gmailThreadId]
  );
  const participantList = participants.map(p => p.from_address);

  await pool.execute(`
    INSERT INTO mw_threads
      (mailbox_id, gmail_thread_id, subject, message_count, last_message_at, participants)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      message_count = VALUES(message_count),
      last_message_at = GREATEST(COALESCE(last_message_at, '1970-01-01'), VALUES(last_message_at)),
      participants = VALUES(participants),
      subject = COALESCE(subject, VALUES(subject))
  `, [
    mailboxId,
    gmailThreadId,
    messageParsed.subject,
    messageCount,
    messageParsed.date,
    JSON.stringify(participantList),
  ]);
}

/**
 * Parsa Gmail API-meddelande till DB-format
 */
export function parseGmailMessage(gmailMessage) {
  const headers = {};
  for (const h of gmailMessage.payload?.headers || []) {
    headers[h.name.toLowerCase()] = h.value;
  }

  // Extrahera namn och adress från From-header
  const fromParsed = parseEmailAddress(headers.from || '');

  // Parsa To och Cc
  const toAddresses = parseEmailList(headers.to || '');
  const ccAddresses = parseEmailList(headers.cc || '');

  // Extrahera body
  const { text, html } = extractEmailBody(gmailMessage.payload);

  // Formatera datum
  const dateStr = headers.date
    ? formatMysqlDate(new Date(headers.date))
    : formatMysqlDate(new Date(parseInt(gmailMessage.internalDate)));

  // Labels
  const labels = gmailMessage.labelIds || [];
  const isRead = !labels.includes('UNREAD');
  const isStarred = labels.includes('STARRED');

  // Bilagor
  const hasAttachments = checkHasAttachments(gmailMessage.payload);

  return {
    gmailId: gmailMessage.id,
    threadId: gmailMessage.threadId,
    subject: headers.subject || '(inget ämne)',
    fromAddress: fromParsed.address,
    fromName: fromParsed.name,
    toAddresses,
    ccAddresses,
    date: dateStr,
    snippet: gmailMessage.snippet || '',
    bodyText: text,
    bodyHtml: html,
    labels,
    isRead,
    isStarred,
    hasAttachments,
    sizeEstimate: gmailMessage.sizeEstimate || 0,
  };
}

/**
 * Extrahera e-postens brödtext (text/plain och text/html)
 * Traverserar rekursivt genom MIME-delar
 */
export function extractEmailBody(payload) {
  let text = '';
  let html = '';

  if (!payload) return { text, html };

  // Enkel del
  if (payload.body?.data) {
    const decoded = base64UrlDecode(payload.body.data);
    const mime = payload.mimeType || '';
    if (mime === 'text/plain') text = decoded;
    if (mime === 'text/html') html = decoded;
  }

  // Multipart — traversera delar
  if (payload.parts) {
    for (const part of payload.parts) {
      const sub = extractEmailBody(part);
      if (sub.text && !text) text = sub.text;
      if (sub.html && !html) html = sub.html;
    }
  }

  return { text, html };
}

// --- Hjälpfunktioner ---

function parseEmailAddress(raw) {
  const match = raw.match(/^"?([^"<]*)"?\s*<?([^>]+)>?$/);
  if (match) {
    return { name: match[1].trim(), address: match[2].trim() };
  }
  return { name: '', address: raw.trim() };
}

function parseEmailList(raw) {
  if (!raw) return [];
  return raw.split(',').map(addr => parseEmailAddress(addr.trim()));
}

function checkHasAttachments(payload) {
  if (!payload) return false;
  if (payload.filename && payload.filename.length > 0 && payload.body?.attachmentId) return true;
  if (payload.parts) {
    return payload.parts.some(part => checkHasAttachments(part));
  }
  return false;
}

function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10).replace(/-/g, '/');
}

function formatMysqlDate(date) {
  if (isNaN(date.getTime())) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
