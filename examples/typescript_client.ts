/**
 * WindsurfAPI — TypeScript client examples
 * ==========================================
 *
 * Three usage modes:
 *   1. Native OpenAI SDK (npm i openai)
 *   2. Anthropic SDK (npm i @anthropic-ai/sdk)
 *   3. Pure fetch — zero dependencies, works on Node 20+ / Bun / Deno / browser
 *
 * Run:
 *   npx tsx examples/typescript_client.ts
 */

const BASE = process.env.WINDSURF_BASE ?? 'http://localhost:3003';
const API_KEY = process.env.WINDSURF_API_KEY ?? 'sk-dummy';

// ─────────────────────────────────────────────────────────
// Example 1: Pure fetch — zero-dependency streaming
// ─────────────────────────────────────────────────────────
async function fetchStreaming() {
  const resp = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'claude-4.5-sonnet',
      messages: [{ role: 'user', content: 'Write one line of TypeScript code' }],
      stream: true,
    }),
  });

  if (!resp.ok || !resp.body) {
    console.error('[fetch] HTTP', resp.status, await resp.text());
    return;
  }

  process.stdout.write('[fetch] streaming: ');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by "\n\n"; each message starts with "data: "
    const lines = buffer.split('\n\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') return process.stdout.write('\n');
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content ?? '';
        if (delta) process.stdout.write(delta);
      } catch {
        /* ignore partial frames */
      }
    }
  }
  process.stdout.write('\n');
}

// ─────────────────────────────────────────────────────────
// Example 2: OpenAI SDK
// ─────────────────────────────────────────────────────────
async function openaiSdk() {
  let OpenAI: any;
  try {
    // @ts-ignore — optional peer dep; may not be installed
    OpenAI = (await import('openai')).default;
  } catch {
    console.log('[skip] Run "npm i openai" first to use example 2');
    return;
  }

  const client = new OpenAI({ apiKey: API_KEY, baseURL: `${BASE}/v1` });
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'What is WindsurfAPI? One sentence.' }],
  });
  console.log('[openai]', res.choices[0].message.content);
  console.log('[openai] usage:', res.usage);
}

// ─────────────────────────────────────────────────────────
// Example 3: Anthropic SDK (/v1/messages)
// ─────────────────────────────────────────────────────────
async function anthropicSdk() {
  let Anthropic: any;
  try {
    // @ts-ignore — optional peer dep; may not be installed
    Anthropic = (await import('@anthropic-ai/sdk')).default;
  } catch {
    console.log('[skip] Run "npm i @anthropic-ai/sdk" first to use example 3');
    return;
  }

  const client = new Anthropic({ apiKey: API_KEY, baseURL: BASE });
  const msg = await client.messages.create({
    model: 'claude-4.5-sonnet',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'Hello from TypeScript!' }],
  });
  console.log('[anthropic]', (msg.content[0] as any).text);
}

// ─────────────────────────────────────────────────────────
// Dashboard API example — fetch usage snapshot
// ─────────────────────────────────────────────────────────
async function usageStats() {
  const pw = process.env.DASHBOARD_PASSWORD ?? '';
  const resp = await fetch(`${BASE}/dashboard/api/usage`, {
    headers: { 'X-Dashboard-Password': pw },
  });
  if (!resp.ok) {
    console.error('[usage] HTTP', resp.status);
    return;
  }
  const { usage: u } = await resp.json();
  console.log(`[usage] Total requests: ${u.total_requests}`);
  console.log(`[usage] Total tokens: ${u.total_tokens.toLocaleString()}`);
  console.log(`[usage] Credits: ${u.total_credits.toFixed(1)}`);
}

// ─────────────────────────────────────────────────────────
(async () => {
  console.log('='.repeat(60));
  console.log(`  WindsurfAPI @ ${BASE}`);
  console.log('='.repeat(60));
  await fetchStreaming();
  console.log();
  await openaiSdk();
  console.log();
  await anthropicSdk();
  console.log();
  await usageStats();
})();
