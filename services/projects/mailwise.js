/**
 * MailWise — AI-driven e-posthantering
 *
 * Multi-brevlåda Gmail-integration med LLM-analys via Ollama.
 * OAuth2 Authorization Code flow för per-brevlåda-åtkomst.
 * LLM-bearbetning via Ollama på Proxmox (WireGuard-tunnel).
 */

export default {
  id: 'mailwise',
  name: 'MailWise',
  description: 'AI-driven e-posthantering — Gmail-integration, FAQ-extraktion och inkorgsanalys',
  color: '#6366f1',
  tablePrefix: 'mw',
  type: 'hybrid',

  // Gmail API
  gmail: {
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    maxResults: 50,
    syncIntervalMs: 300_000,
  },

  // Ollama (Proxmox via WireGuard)
  ollama: {
    defaultHost: '10.10.10.104',
    defaultPort: 11434,
    defaultModel: 'llama3.1:8b',
    timeout: 120_000,
  },

  // Cron-intervall (Europe/Stockholm)
  intervals: {
    sync: '*/5 * * * *',
    analysis: '*/15 * * * *',
    rollup: '5 0 * * *',
    cleanup: '15 0 * * *',
    tokenRefresh: '*/30 * * * *',
  },

  statsEndpoint: '/stats',
};
