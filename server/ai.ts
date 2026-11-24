/**
 * AI assistant and voice, using free tiers. Keys stay on the server.
 *
 * Chat: tries each configured provider in order and falls back to the next if one is
 * busy or over its free limit. All three speak the same (OpenAI-style) language.
 *   GROQ_API_KEY        → Groq, model openai/gpt-oss-120b   (console.groq.com, free, no card)
 *   GEMINI_API_KEY      → Google Gemini, gemini-2.5-flash   (aistudio.google.com, free tier)
 *   OPENROUTER_API_KEY  → OpenRouter free models router      (openrouter.ai, free models)
 * Voice: Groq's hosted Whisper (open-source speech-to-text), whisper-large-v3-turbo.
 */
import type { ApiResult } from './sync.js';

interface Provider {
  name: string;
  url: string;
  key: string;
  model: string;
}

function providers(): Provider[] {
  const e = process.env;
  const list: Provider[] = [];
  if (e.GROQ_API_KEY)
    list.push({ name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: e.GROQ_API_KEY, model: e.GROQ_MODEL || 'openai/gpt-oss-120b' });
  if (e.GEMINI_API_KEY)
    list.push({
      name: 'Gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      key: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL || 'gemini-2.5-flash',
    });
  if (e.OPENROUTER_API_KEY)
    list.push({ name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: e.OPENROUTER_API_KEY, model: e.OPENROUTER_MODEL || 'openrouter/free' });
  return list;
}

export function aiStatus(): ApiResult {
  return { status: 200, body: { chat: providers().length > 0, voice: Boolean(process.env.GROQ_API_KEY), providers: providers().map((p) => p.name) } };
}

const MAX_BODY = 300_000;

export async function aiChat(body: { messages?: unknown[]; tools?: unknown[] }): Promise<ApiResult> {
  const list = providers();
  if (!list.length) return { status: 503, body: { error: 'The assistant is not set up yet. An admin needs to add a free AI key.' } };
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 60) return { status: 400, body: { error: 'Bad conversation' } };
  if (JSON.stringify(body).length > MAX_BODY) return { status: 413, body: { error: 'Conversation is too long. Start a new chat.' } };

  const errors: string[] = [];
  for (const p of list) {
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${p.key}`,
          ...(p.name === 'OpenRouter' ? { 'HTTP-Referer': 'https://ffim-gather.app', 'X-Title': 'FFIM Gather' } : {}),
        },
        body: JSON.stringify({
          model: p.model,
          messages: body.messages,
          ...(Array.isArray(body.tools) && body.tools.length ? { tools: body.tools, tool_choice: 'auto' } : {}),
          temperature: 0.3,
          max_tokens: 1200,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.choices?.[0]?.message) {
        errors.push(`${p.name}: ${res.status} ${data?.error?.message ?? ''}`.trim());
        continue; // busy, over the free limit or unavailable: try the next one
      }
      const m = data.choices[0].message;
      return {
        status: 200,
        body: {
          provider: p.name,
          message: { role: 'assistant', content: m.content ?? '', ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) },
        },
      };
    } catch (e) {
      errors.push(`${p.name}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }
  console.error('All AI providers failed', errors);
  return { status: 502, body: { error: 'The assistant is busy right now. Try again in a minute.', details: errors } };
}

/** Speech to text with Whisper on Groq. Body: { audio: base64, mime: 'audio/webm' } */
export async function aiTranscribe(body: { audio?: string; mime?: string }): Promise<ApiResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { status: 503, body: { error: 'Voice is not set up yet (needs a free Groq key).' } };
  if (!body.audio || typeof body.audio !== 'string') return { status: 400, body: { error: 'No audio' } };
  const bytes = Buffer.from(body.audio, 'base64');
  if (bytes.length > 3_500_000) return { status: 413, body: { error: 'Recording is too long' } };
  const mime = String(body.mime || 'audio/webm').split(';')[0];
  const ext = mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), `voice.${ext}`);
  form.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { status: 502, body: { error: 'Could not understand the recording. Try again.', details: data?.error?.message } };
  return { status: 200, body: { text: String(data?.text ?? '').trim() } };
}
