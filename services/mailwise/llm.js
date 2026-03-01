/**
 * Ollama LLM-klient — Analys av e-post via Ollama REST API
 *
 * Anropar Ollama på Proxmox via WireGuard (10.10.10.x:11434).
 * Alla prompts returnerar strukturerad JSON.
 */

import { getSettings } from '../db/settings.js';

/**
 * Hämta Ollama-URL från inställningar
 */
async function getOllamaConfig() {
  const settings = await getSettings('mailwise');
  const host = settings?.ollama_host || '10.10.10.104';
  const port = settings?.ollama_port || '11434';
  const model = settings?.ollama_model || 'llama3.1:8b';
  return { baseUrl: `http://${host}:${port}`, model };
}

/**
 * Testa Ollama-anslutning
 */
export async function testOllamaConnection() {
  try {
    const { baseUrl, model } = await getOllamaConfig();

    // Testa TCP-anslutning (GET /api/tags)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ok: false, error: `Ollama svarar med ${res.status}` };
    }

    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    const modelAvailable = models.some(m => m.startsWith(model.split(':')[0]));

    return {
      ok: true,
      models,
      configuredModel: model,
      modelAvailable,
      message: modelAvailable
        ? `Ansluten — modell ${model} tillgänglig`
        : `Ansluten men modell ${model} saknas (tillgängliga: ${models.join(', ')})`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'Timeout (10s)' : err.message,
    };
  }
}

/**
 * Generera LLM-svar (POST /api/generate)
 */
async function generate(prompt, options = {}) {
  const { baseUrl, model } = await getOllamaConfig();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 120_000);

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || model,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.3,
          num_predict: options.maxTokens || 2048,
        },
        format: 'json',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${text}`);
    }

    const data = await res.json();
    return {
      response: data.response,
      totalDuration: data.total_duration,
      evalCount: data.eval_count,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Ollama timeout — modellen svarade inte i tid');
    }
    throw err;
  }
}

/**
 * Parsa JSON-svar från LLM (med felhantering)
 */
function parseJsonResponse(response) {
  try {
    return JSON.parse(response);
  } catch {
    // Försök extrahera JSON från text
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* ignorera */ }
    }
    const arrMatch = response.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]); } catch { /* ignorera */ }
    }
    throw new Error('Kunde inte parsa LLM-svar som JSON');
  }
}

/**
 * Analysera ett enskilt meddelande
 *
 * Returnerar: { category, priority, sentiment, summary }
 */
export async function analyzeMessage(messageText, subject, fromAddress) {
  const prompt = `Du är en e-postanalysexpert. Analysera följande e-postmeddelande och returnera ett JSON-objekt.

Ämne: ${subject || '(inget ämne)'}
Från: ${fromAddress || 'okänd'}

Meddelande:
${(messageText || '').slice(0, 3000)}

Returnera EXAKT detta JSON-format:
{
  "category": "en av: inquiry, complaint, order, support, billing, feedback, info, other",
  "priority": "en av: low, normal, high, urgent",
  "sentiment": "en av: positive, neutral, negative",
  "summary": "1-2 meningar på svenska som sammanfattar meddelandet"
}

Svara BARA med JSON, inget annat.`;

  const result = await generate(prompt);
  const parsed = parseJsonResponse(result.response);

  // Validera och normalisera
  const validCategories = ['inquiry', 'complaint', 'order', 'support', 'billing', 'feedback', 'info', 'other'];
  const validPriorities = ['low', 'normal', 'high', 'urgent'];
  const validSentiments = ['positive', 'neutral', 'negative'];

  return {
    category: validCategories.includes(parsed.category) ? parsed.category : 'other',
    priority: validPriorities.includes(parsed.priority) ? parsed.priority : 'normal',
    sentiment: validSentiments.includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
    summary: (parsed.summary || '').slice(0, 1000),
  };
}

/**
 * Analysera en hel tråd
 *
 * Returnerar: { summary, resolved, keyTopics }
 */
export async function analyzeThread(messages) {
  const threadText = messages
    .map(m => `[${m.from_address || 'okänd'} - ${m.date || ''}]\n${(m.body_text || m.snippet || '').slice(0, 1000)}`)
    .join('\n\n---\n\n')
    .slice(0, 6000);

  const prompt = `Du är en e-postanalysexpert. Analysera denna e-posttråd och returnera ett JSON-objekt.

Tråd (${messages.length} meddelanden):
${threadText}

Returnera EXAKT detta JSON-format:
{
  "summary": "2-3 meningar på svenska som sammanfattar hela konversationen",
  "resolved": true/false (om ärendet verkar löst/besvarat),
  "keyTopics": ["ämne1", "ämne2"]
}

Svara BARA med JSON, inget annat.`;

  const result = await generate(prompt);
  const parsed = parseJsonResponse(result.response);

  return {
    summary: (parsed.summary || '').slice(0, 2000),
    resolved: !!parsed.resolved,
    keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics.slice(0, 10) : [],
  };
}

/**
 * Extrahera FAQ-par från e-posttråd(ar)
 *
 * Returnerar: [{ question, answer, confidence, tags }]
 */
export async function extractFAQs(messages) {
  const threadText = messages
    .map(m => `[${m.from_address || 'okänd'}]\n${(m.body_text || m.snippet || '').slice(0, 1500)}`)
    .join('\n\n---\n\n')
    .slice(0, 8000);

  const prompt = `Du är expert på att extrahera FAQ (vanliga frågor och svar) från e-postkonversationer.

Analysera denna e-postkonversation och identifiera frågor som ställs och svar som ges.

Konversation:
${threadText}

Returnera en JSON-array med FAQ-par. Varje par ska ha:
- question: Frågan omformulerad som en tydlig FAQ-fråga (på svenska)
- answer: Svaret, sammanfattat och tydligt (på svenska)
- confidence: 0.0-1.0, hur säker du är på att detta är en korrekt FAQ
- tags: Array med relevanta taggar (t.ex. ["leverans", "retur", "pris"])

Returnera BARA JSON-arrayen, inget annat. Om inga FAQ-par kan extraheras, returnera en tom array [].`;

  const result = await generate(prompt, { maxTokens: 4096 });
  const parsed = parseJsonResponse(result.response);

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(item => item.question && item.answer)
    .map(item => ({
      question: String(item.question).slice(0, 1000),
      answer: String(item.answer).slice(0, 2000),
      confidence: Math.max(0, Math.min(1, parseFloat(item.confidence) || 0.5)),
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 10).map(String) : [],
    }));
}

/**
 * Generera svarsförslag
 *
 * Returnerar: { draftText, confidence }
 */
export async function generateDraftReply(message, context, tone = 'friendly') {
  const toneDesc = {
    formal: 'formellt och professionellt',
    friendly: 'vänligt och personligt',
    concise: 'kortfattat och rakt på sak',
  };

  const contextSection = context
    ? `\nRelevant kontext (FAQ/tidigare svar):\n${context.slice(0, 2000)}\n`
    : '';

  const prompt = `Du är en expert på att skriva e-postsvar. Skriv ett svarsförslag på det här e-postmeddelandet.

Tonläge: ${toneDesc[tone] || toneDesc.friendly}

Originalmeddelande:
Ämne: ${message.subject || ''}
Från: ${message.from_name || message.from_address || 'okänd'}
Text: ${(message.body_text || message.snippet || '').slice(0, 2000)}
${contextSection}

Returnera JSON:
{
  "draftText": "Svarstext på svenska",
  "confidence": 0.0-1.0
}

Svara BARA med JSON.`;

  const result = await generate(prompt);
  const parsed = parseJsonResponse(result.response);

  return {
    draftText: String(parsed.draftText || '').slice(0, 5000),
    confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.5)),
  };
}

/**
 * Batchanalys — bearbeta meddelanden sekventiellt
 *
 * Returnerar: [{ messageId, ...analysisResult }]
 */
export async function batchAnalyze(messages, onProgress) {
  const results = [];

  for (let i = 0; i < messages.length; i++) {
    try {
      const msg = messages[i];
      const analysis = await analyzeMessage(msg.body_text || msg.snippet, msg.subject, msg.from_address);
      results.push({ messageId: msg.id, ...analysis });

      if (onProgress) {
        onProgress(i + 1, messages.length);
      }
    } catch (err) {
      results.push({ messageId: messages[i].id, error: err.message });
    }
  }

  return results;
}
