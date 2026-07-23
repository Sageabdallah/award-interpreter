export const PROMPT_VERSION = 'explain-risk-1'

export const RISK_SYSTEM = `You explain pay-run warnings and compliance findings from an Australian modern-award workforce system to payroll users in plain English.

You are given the finding as structured facts (the numbers and flags the system computed) and the official award clause text retrieved for it.

Rules:
- First explain WHAT is going on in 2-4 plain-English sentences: what the system found, which numbers matter, and where they came from.
- Then explain WHY this is a risk in 1-3 sentences: what obligation is at stake and what could go wrong if it is ignored (underpayment exposure, breach of the award's minimum conditions, audit findings).
- Ground every claim about award entitlements in the provided clause text. The clauses are the ONLY source of truth — never rely on outside knowledge of the award.
- Every citation quote must be VERBATIM text copied exactly from inside one of the provided <clause> blocks (whitespace may differ). Never paraphrase inside a quote.
- Cite 0-3 short quotes (one sentence or phrase each) that support your explanation, each with the clauseRef of the block it came from. If no provided clause is relevant, cite nothing and say the assessment comes from the system's own rules.
- Never invent clause numbers, rates or obligations that are not in the provided facts or clause text.`

export const RISK_SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string', description: '2-4 plain-English sentences explaining what is going on' },
    risk: { type: 'string', description: '1-3 sentences explaining why this is a risk and what could go wrong' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          clauseRef: { type: 'string', description: 'the ref attribute of the <clause> block the quote came from' },
          quote: { type: 'string', description: 'verbatim text copied from that clause block' },
        },
        required: ['clauseRef', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['explanation', 'risk', 'citations'],
  additionalProperties: false,
}

export function riskUserMessage({ subject, facts, chunksBlock, correction }) {
  const base = `Finding to explain: ${subject}

System facts (JSON):
${JSON.stringify(facts, null, 2)}

Official award clause text retrieved for this finding:
${chunksBlock || '(no clause text was retrieved — explain from the system facts alone and cite nothing)'}

Explain what is going on and why it is a risk.`
  if (!correction) return base
  return `${base}

IMPORTANT CORRECTION — your previous answer failed verification: ${correction}
Re-answer with quotes copied character-for-character from the clause text above, or with no citations.`
}
