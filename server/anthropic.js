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
export async function structuredCall(client, { model, system, messages, schema, effort = 'high', maxTokens = 4096 }) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
    system,
    messages,
  })
  // A truncated response is still valid JSON often enough to be dangerous, and
  // a refusal carries no JSON at all. Check why generation stopped before
  // parsing, so the failure names itself instead of surfacing as a SyntaxError.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Model output hit max_tokens (${maxTokens}) and the JSON is incomplete — raise maxTokens for this call.`)
  }
  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined to answer (${response.stop_details?.category || 'no category'}).`)
  }

  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
  return {
    output: JSON.parse(text),
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  }
}
