// Injectable Anthropic client factory — routes receive the client instance, so
// tests pass a stub instead of mocking SDK internals.
import Anthropic from '@anthropic-ai/sdk'

export function createAnthropicClient({ apiKey }) {
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to .env (see .env.example)')
  }
  return new Anthropic({ apiKey })
}

/**
 * One structured-output call: send messages with an output_config json_schema
 * and return the parsed object. Shared by all routes and the augment script.
 * @returns {Promise<{ output: any, usage: { inputTokens: number, outputTokens: number } }>}
 */
export async function structuredCall(client, { model, system, messages, schema, effort = 'high', maxTokens = 4096, thinking = false, signal = null }) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    // Thinking is off by default: on Sonnet 4.6, adaptive thinking at high
    // effort spends most of the request on thinking tokens, which makes
    // interactive routes slow and can exhaust max_tokens before any text
    // is emitted. Offline batch callers can opt in with thinking: true.
    thinking: { type: thinking ? 'adaptive' : 'disabled' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
    system,
    messages,
  }, signal ? { signal } : undefined)
  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Model hit the ${maxTokens}-token output cap before completing the JSON response — raise maxTokens for this call.`)
  }
  if (!text) {
    throw new Error(`Model returned no text (stop_reason: ${response.stop_reason}).`)
  }
  return {
    output: JSON.parse(text),
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  }
}

/**
 * One streamed plain-text call: onText fires per text delta, the full text is
 * returned at the end. Abort via signal keeps whatever streamed so far AT THE
 * CALLER — an abort surfaces here as a thrown APIUserAbortError.
 * @returns {Promise<string>} the complete streamed text
 */
export async function streamTextCall(client, { model, system, messages, maxTokens = 512, signal = null, onText = null }) {
  const stream = await client.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    system,
    messages,
    stream: true,
  }, signal ? { signal } : undefined)

  let text = ''
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      text += event.delta.text
      onText?.(event.delta.text)
    }
  }
  return text
}
