// Google Gemini through its Interactions API, behind the same loop as Claude (lib/claude-loop.js), like lib/openai-loop.js:
// adapt(post) turns a Messages-API request into an Interactions request and the answer back. The free option (2026-11-19
// Alex: offer Gemini as the free model): an AI Studio key has a free quota, no card. No Node imports: the phone bundle takes
// this file as is.
//   post(body, {timeoutMs}) → the Interactions API's JSON (or throws {status, message})
// Shapes from aistudio.google.com/api-reference/interactions-api/create-interaction (v1, 2026-11-19): POST /v1/interactions
// {model, input: Step[], system_instruction, tools: [{type: 'function', name, description, parameters}], response_format:
// {type: 'text', mime_type: 'application/json', schema}, generation_config: {thinking_level, max_output_tokens}, store}.
// Steps: user_input {content}, model_output {content}, thought {signature, summary}, function_call {id, name, arguments},
// function_result {call_id, name, result}. With store: false every step the model returned (thoughts included, they carry
// the signature) goes back as it came. generateContent is Google's legacy API now: not used.
// Status completed | requires_action (it called a function) | incomplete (max tokens) | failed; usage total_input_tokens,
// total_cached_tokens, total_output_tokens, total_thought_tokens.

// the quick and the deep model, under the names the loop uses for Claude's; both free on AI Studio's free tier
// (aistudio.google.com/docs/models, 2026-11-19: "Gemini 4 Hydrogen or 3.5 Flash-Lite" for new projects)
export const MODELS = { haiku: 'gemini-3.5-flash-lite', sonnet: 'gemini-4-hydrogen' };

const text = (c) => (typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
const say = (role, t) => ({ type: role === 'assistant' ? 'model_output' : 'user_input', content: [{ type: 'text', text: t }] });
// Claude's effort → Gemini's thinking level; Haiku's "thinking off" → minimal
const LEVEL = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };

export function toRequest(body) {
  const input = [], names = {};
  for (const m of body.messages || []) {
    if (typeof m.content === 'string') { input.push(say(m.role, m.content)); continue; }
    if (m.role === 'assistant') {
      const raw = m.content.find((b) => b.type === 'gemini_output');
      if (raw) {
        for (const s of raw.steps) if (s.type === 'function_call') names[s.id] = s.name;
        input.push(...raw.steps); // as they came: thoughts, output and calls, in order
      } else if (text(m.content)) input.push(say('assistant', text(m.content)));
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'tool_result') input.push({ type: 'function_result', call_id: b.tool_use_id, ...(names[b.tool_use_id] ? { name: names[b.tool_use_id] } : {}), result: typeof b.content === 'string' ? b.content : text(b.content), ...(b.is_error ? { is_error: true } : {}) });
      else if (b.type === 'text') input.push(say('user', b.text));
    }
  }
  const tools = (body.tools || []).map((t) => (/^web_search/.test(t.type || '') ? { type: 'google_search' }
    : t.type && t.type !== 'custom' ? null // Claude's other server tools (web_fetch): the search reads pages too
      : { type: 'function', name: t.name, description: t.description || '', parameters: t.input_schema })).filter(Boolean);
  const format = body.output_config?.format;
  return {
    model: body.model,
    system_instruction: typeof body.system === 'string' ? body.system : text(body.system),
    input,
    ...(tools.length ? { tools } : {}),
    ...(format ? { response_format: { type: 'text', mime_type: 'application/json', schema: format.schema } } : {}),
    generation_config: { thinking_level: body.thinking?.type === 'disabled' ? 'minimal' : LEVEL[body.output_config?.effort] || 'low', max_output_tokens: body.max_tokens || 16000 },
    store: false,
  };
}

export function fromResponse(j) {
  if (j.status === 'failed' || j.status === 'cancelled') throw Object.assign(new Error(j.error?.message || `the interaction ${j.status}`), { status: 502 });
  const steps = j.steps || [], content = [];
  let searches = 0;
  for (const s of steps) {
    if (s.type === 'model_output') { const t = text(s.content); if (t) content.push({ type: 'text', text: t }); }
    else if (s.type === 'function_call') content.push({ type: 'tool_use', id: s.id, name: s.name, input: s.arguments || {} });
    else if (s.type === 'google_search_call') searches++;
  }
  content.push({ type: 'gemini_output', steps }); // replayed as is on the next round (lib/claude-loop.js keeps the content)
  const u = j.usage || {}, cached = u.total_cached_tokens || 0;
  return {
    content,
    stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : j.status === 'incomplete' ? 'max_tokens' : 'end_turn',
    // thinking is paid as output
    usage: { input_tokens: Math.max(0, (u.total_input_tokens || 0) - cached), cache_read_input_tokens: cached, output_tokens: (u.total_output_tokens || 0) + (u.total_thought_tokens || 0), server_tool_use: { web_search_requests: searches } },
  };
}

// The deep model busy ("high demand" 503 after the retries, or no answer in time: 2026-11-20 it took a minute to say 503)
// → the quick one answers that request, rather than an error. On the Mac the error has a status; on the phone only the
// text Gubernos/Claude.swift makes ("Gemini API 503: …", or the URL session's "timed out").
const busy = (e) => e?.status === 503 || e?.status === 0 || /^Gemini API 503|high demand|timed out|aborted due to timeout/i.test(String(e?.message || ''));
export const adapt = (post) => async (body, opts) => {
  try { return fromResponse(await post(toRequest(body), opts)); } catch (e) {
    if (body.model !== MODELS.sonnet || !busy(e)) throw e;
    return fromResponse(await post(toRequest({ ...body, model: MODELS.haiku }), opts));
  }
};
