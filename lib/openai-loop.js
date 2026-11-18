// OpenAI through its Responses API, behind the same loop as Claude (lib/claude-loop.js): adapt(post) turns a Messages-API
// request into a Responses request and the answer back, so the loop, its file tools, the chat and the agents need no second
// copy. No Node imports: the phone bundle can take this file as is, like claude-loop.js.
//   post(body, {timeoutMs}) → the Responses API's JSON (or throws {status, message})
// Shapes from developers.openai.com/api/docs/guides/function-calling and …/reasoning (2026-11-18): tools {type: 'function',
// name, description, parameters}; output items function_call {call_id, name, arguments: JSON text}; results go back as
// function_call_output {call_id, output}; with store: false every output item (reasoning included, it carries its
// encrypted_content) is replayed in order; usage input_tokens, input_tokens_details.cached_tokens, output_tokens.

// the quick and the deep model, under the names the loop uses for Claude's (developers.openai.com/api/docs/models, 2026-11-18:
// gpt-6-luna for cost-sensitive, high-volume work; gpt-6.2-sol at Sonnet's price)
export const MODELS = { haiku: 'gpt-6-luna', sonnet: 'gpt-6.2-sol' };

const text = (c) => (typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

export function toRequest(body) {
  const input = [];
  for (const m of body.messages || []) {
    if (typeof m.content === 'string') { input.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const raw = m.content.find((b) => b.type === 'openai_output');
      if (raw) input.push(...raw.items); // as it came: reasoning, messages and calls, in order
      else if (text(m.content)) input.push({ role: 'assistant', content: text(m.content) });
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'tool_result') input.push({ type: 'function_call_output', call_id: b.tool_use_id, output: typeof b.content === 'string' ? b.content : text(b.content) });
      else if (b.type === 'text') input.push({ role: 'user', content: b.text });
    }
  }
  const tools = (body.tools || []).map((t) => (/^web_search/.test(t.type || '') ? { type: 'web_search' }
    : t.type && t.type !== 'custom' ? null // Claude's other server tools (web_fetch): the web search reads pages too
      : { type: 'function', name: t.name, description: t.description || '', parameters: t.input_schema, strict: false })).filter(Boolean);
  const format = body.output_config?.format;
  return {
    model: body.model,
    instructions: typeof body.system === 'string' ? body.system : text(body.system),
    input,
    ...(tools.length ? { tools } : {}),
    reasoning: { effort: body.thinking?.type === 'disabled' ? 'none' : body.output_config?.effort || 'low' },
    ...(format ? { text: { format: { type: 'json_schema', name: 'answer', schema: format.schema, strict: false } } } : {}),
    max_output_tokens: body.max_tokens || 16000,
    store: false,
  };
}

export function fromResponse(j) {
  const items = j.output || [], content = [];
  let refused = false, searches = 0;
  for (const it of items) {
    if (it.type === 'message') {
      for (const c of it.content || []) {
        if (c.type === 'output_text') content.push({ type: 'text', text: c.text });
        if (c.type === 'refusal') refused = true;
      }
    } else if (it.type === 'function_call') {
      let input = {};
      try { input = JSON.parse(it.arguments || '{}'); } catch { /* the tool says what was wrong */ }
      content.push({ type: 'tool_use', id: it.call_id, name: it.name, input });
    } else if (it.type === 'web_search_call') searches++;
  }
  content.push({ type: 'openai_output', items }); // replayed as is on the next round (lib/claude-loop.js keeps the content)
  const u = j.usage || {}, cached = u.input_tokens_details?.cached_tokens || 0;
  return {
    content,
    stop_reason: refused ? 'refusal' : content.some((b) => b.type === 'tool_use') ? 'tool_use'
      : j.status === 'incomplete' && j.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : 'end_turn',
    usage: { input_tokens: Math.max(0, (u.input_tokens || 0) - cached), cache_read_input_tokens: cached, output_tokens: u.output_tokens || 0, server_tool_use: { web_search_requests: searches } },
  };
}

export const adapt = (post) => async (body, opts) => fromResponse(await post(toRequest(body), opts));
