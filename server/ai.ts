/**
 * Central AI client — all AI calls go through this module.
 * Text model: deepseek-ai/deepseek-v4-pro via NVIDIA NIM
 * Vision model: meta/llama-3.2-90b-vision-instruct via NVIDIA NIM
 */

export const AI_MODEL = "deepseek-ai/deepseek-v4-pro";
export const AI_VISION_MODEL = "meta/llama-3.2-90b-vision-instruct";
export const AI_PROVIDER_NAME = "NVIDIA NIM";

const AI_BASE_URL = "https://integrate.api.nvidia.com/v1";
const AI_VISION_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const CHAT_TIMEOUT_MS = 45_000;
const STREAM_TIMEOUT_MS = 60_000;

if (!process.env.AI_API_KEY) {
  console.warn("[ai] WARNING: AI_API_KEY is not set — all AI features will fail");
}

export async function callAIChat(
  messages: Array<{ role: string; content: string }>,
  options?: { tools?: any[]; temperature?: number; maxTokens?: number; stream?: false }
): Promise<any> {
  const body: any = {
    model: AI_MODEL,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    stream: false,
    extra_body: { chat_template_kwargs: { thinking: false } },
  };

  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[ai] callAIChat error:", res.status, errText);
      throw new Error("AI temporarily unavailable, try again");
    }

    return res.json();
  } catch (err: any) {
    if (err.name === "AbortError") throw new Error("AI request timed out, try again");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function callAIChatStream(
  messages: Array<{ role: string; content: string }>,
  options?: { tools?: any[]; temperature?: number; maxTokens?: number }
): Promise<Response> {
  const body: any = {
    model: AI_MODEL,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    extra_body: { chat_template_kwargs: { thinking: false } },
    stream: true,
  };

  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      clearTimeout(timer);
      const errText = await res.text();
      console.error("[ai] callAIChatStream error:", res.status, errText);
      throw new Error("AI temporarily unavailable, try again");
    }

    return res;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("AI stream timed out, try again");
    throw err;
  }
}

export async function callAIVision(
  messages: Array<{ role: string; content: any }>,
  options?: { maxTokens?: number }
): Promise<any> {
  const body = {
    model: AI_VISION_MODEL,
    messages,
    max_tokens: options?.maxTokens ?? 512,
    temperature: 1.0,
    top_p: 1.0,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
    stream: false,
  };

  const res = await fetch(AI_VISION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${process.env.AI_VISION_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[ai] callAIVision error:", res.status, errText);
    throw new Error("AI temporarily unavailable, try again");
  }

  return res.json();
}
