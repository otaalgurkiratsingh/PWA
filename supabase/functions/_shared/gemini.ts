/**
 * Server-side Gemini adapter. Stateless: no conversation chaining, no background mode,
 * no tools, no grounding. The key is passed in from Edge Function secrets by the caller.
 *
 * Two request styles are supported because the build environment could not reach Google's
 * documentation to confirm the newest API on 2026-10-09:
 *  - 'generate_content' (default): POST v1beta/models/{model}:generateContent. Requests are not
 *    stored for chaining by this API.
 *  - 'interactions': POST v1beta/interactions with store=false (no previous_interaction_id, no
 *    background). Field names follow Google's published examples and must be confirmed with the
 *    live smoke test before use (see docs/OWNER_GUIDE.md).
 */

export interface ModelRequest {
  apiKey: string;
  model: string;
  style: 'generate_content' | 'interactions';
  system: string;
  text: string;
  imageJpegBase64?: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface ModelUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  total_tokens: number | null;
}

export interface ModelResult {
  json: unknown;
  usage: ModelUsage;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function callModel(r: ModelRequest): Promise<ModelResult> {
  const f = r.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), r.timeoutMs);
  try {
    if (r.style === 'interactions') {
      const input: unknown[] = [{ type: 'text', text: r.text }];
      if (r.imageJpegBase64) input.push({ type: 'image', mime_type: 'image/jpeg', data: r.imageJpegBase64 });
      const res = await f(`${BASE}/interactions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': r.apiKey },
        body: JSON.stringify({
          model: r.model,
          input,
          system_instruction: r.system,
          store: false,
          generation_config: { thinking_level: 'low', max_output_tokens: r.maxOutputTokens, temperature: 0.4 },
          response_format: r.jsonSchema,
          response_mime_type: 'application/json',
        }),
      });
      if (!res.ok) throw new ProviderError(`provider HTTP ${res.status}`, res.status);
      const body = (await res.json()) as Record<string, unknown>;
      const texts: string[] = [];
      const collect = (items: unknown) => {
        if (!Array.isArray(items)) return;
        for (const it of items as Record<string, unknown>[]) {
          if (typeof it.text === 'string' && it.type !== 'thought') texts.push(it.text);
          if (Array.isArray(it.content)) collect(it.content);
        }
      };
      collect(body.outputs);
      collect((body.steps as Record<string, unknown>[] | undefined)?.filter((s) => s.type === 'model_output'));
      const usage = (body.usage ?? {}) as Record<string, unknown>;
      return {
        json: parseJsonText(texts.join('')),
        usage: {
          input_tokens: numOrNull(usage.total_input_tokens ?? usage.input_tokens),
          output_tokens: numOrNull(usage.total_output_tokens ?? usage.output_tokens),
          thinking_tokens: numOrNull(usage.total_thought_tokens ?? usage.thought_tokens),
          total_tokens: numOrNull(usage.total_tokens),
        },
      };
    }

    const parts: unknown[] = [{ text: r.text }];
    if (r.imageJpegBase64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: r.imageJpegBase64 } });
    const res = await f(`${BASE}/models/${encodeURIComponent(r.model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': r.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          maxOutputTokens: r.maxOutputTokens,
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseJsonSchema: r.jsonSchema,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    });
    if (!res.ok) throw new ProviderError(`provider HTTP ${res.status}`, res.status);
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: Record<string, unknown>;
    };
    const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    const u = body.usageMetadata ?? {};
    return {
      json: parseJsonText(text),
      usage: {
        input_tokens: numOrNull(u.promptTokenCount),
        output_tokens: numOrNull(u.candidatesTokenCount),
        thinking_tokens: numOrNull(u.thoughtsTokenCount),
        total_tokens: numOrNull(u.totalTokenCount),
      },
    };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(e instanceof Error && e.name === 'AbortError' ? 'provider timeout' : 'provider request failed');
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonText(text: string): unknown {
  if (!text) throw new ProviderError('empty model output');
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('model output was not JSON');
  }
}

export interface Pricing {
  /** US$ per 1M input tokens (text + image). */
  inputPerMTok: number;
  /** US$ per 1M output tokens (thinking tokens are billed as output). */
  outputPerMTok: number;
}

/** Conservative upper bound used for the reservation before the call. */
export function reservationUsd(p: Pricing, maxInputTokens: number, maxOutputTokens: number): number {
  return Math.max(0.0001, (maxInputTokens * p.inputPerMTok + maxOutputTokens * p.outputPerMTok) / 1e6);
}

/** Actual cost from reported usage; null when the provider did not report usage (reservation is kept). */
export function actualUsd(p: Pricing, u: ModelUsage): number | null {
  if (u.input_tokens === null || u.output_tokens === null) return null;
  const out = u.output_tokens + (u.thinking_tokens ?? 0);
  return (u.input_tokens * p.inputPerMTok + out * p.outputPerMTok) / 1e6;
}
