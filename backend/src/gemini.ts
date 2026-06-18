/**
 * Models that typically have non-zero free-tier quota on the Gemini Developer API.
 * `gemini-2.0-flash` often returns 429 with free_tier limit 0 for new keys — avoid as default.
 */
const FREE_TIER_MODEL_FALLBACKS = ["gemini-3.1-flash-lite", "gemini-1.5-flash", "gemini-1.5-flash-8b"] as const;

class GeminiHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "GeminiHttpError";
    this.status = status;
    this.body = body;
  }
}

function extractTextFromResponse(data: unknown): string {
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (d.error?.message) throw new Error(d.error.message);
  const parts = d.candidates?.[0]?.content?.parts;
  if (!parts?.length) {
    throw new Error("Gemini returned no text (empty candidates or blocked content).");
  }
  return parts.map((p) => p.text ?? "").join("").trim() || "(No text in response.)";
}

function formatApiError(status: number, data: unknown): string {
  const msg =
    typeof (data as { error?: { message?: string } })?.error?.message === "string"
      ? (data as { error: { message: string } }).error.message
      : JSON.stringify(data);
  return `Gemini request failed (${status}): ${msg}`;
}

export type GeminiGenerateOptions = {
  /** Clamped to 256–8192. Default 4096. */
  maxOutputTokens?: number;
};

async function generateForModel(
  apiKey: string,
  model: string,
  systemInstruction: string,
  userText: string,
  maxOutputTokens: number
): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new Error("GEMINI_MODEL must contain only letters, numbers, dots, underscores, and hyphens.");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.55,
        maxOutputTokens,
      },
    }),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new GeminiHttpError("Gemini returned an invalid response body.", res.status, null);
  }
  if (!res.ok) {
    throw new GeminiHttpError(formatApiError(res.status, data), res.status, data);
  }
  return extractTextFromResponse(data);
}

function shouldFallbackToNextModel(err: unknown): boolean {
  if (!(err instanceof GeminiHttpError)) return false;
  if (err.status === 404 || err.status === 429) return true;
  const msg = err.message.toLowerCase();
  if (msg.includes("free_tier") && msg.includes("limit: 0")) return true;
  if (msg.includes("quota")) return true;
  if (msg.includes("not found") && msg.includes("model")) return true;
  return false;
}

export async function geminiGenerateText(
  systemInstruction: string,
  userText: string,
  options?: GeminiGenerateOptions
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Add it to the server environment to use Advanced Analytics.");
  }
  const explicit = process.env.GEMINI_MODEL?.trim();
  const candidates = explicit ? [explicit] : [...FREE_TIER_MODEL_FALLBACKS];
  const maxOutputTokens = Math.min(8192, Math.max(256, options?.maxOutputTokens ?? 4096));

  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]!;
    try {
      return await generateForModel(apiKey, model, systemInstruction, userText, maxOutputTokens);
    } catch (e) {
      lastErr = e;
      if (explicit) throw e;
      const canRetry = i < candidates.length - 1 && shouldFallbackToNextModel(e);
      if (!canRetry) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Human-readable policy for Advanced Analytics UI (matches `geminiGenerateText` model selection). */
export function getGeminiAnalyticsModelPolicy(): string {
  const explicit = process.env.GEMINI_MODEL?.trim();
  if (explicit) {
    return `Gemini model: ${explicit} (GEMINI_MODEL override).`;
  }
  return `Gemini models (first success): ${FREE_TIER_MODEL_FALLBACKS.join(" → ")}.`;
}
