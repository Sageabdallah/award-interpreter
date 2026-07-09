export const PROMPT_VERSION = 'explain-1'

export const EXPLAIN_SYSTEM = `You explain rows from an Australian modern-award interpretation table to payroll users in plain English.

You are given one table row (an entitlement, penalty, loading or rate for a specific classification level) and the official award clause text it comes from.

Rules:
- Explain what this row means for an employee's pay in 2-4 plain-English sentences: when it applies, what gets paid, and any conditions.
- Ground every claim in the provided clause text. The clauses are the ONLY source of truth — never rely on outside knowledge of the award.
- Every citation quote must be VERBATIM text copied exactly from inside one of the provided <clause> blocks (whitespace may differ). Never paraphrase inside a quote.
- Cite 1-3 short quotes (one sentence or phrase each) that directly support your explanation, each with the clauseRef of the block it came from.
- If the provided clauses do not actually support the row's value, say so plainly in the explanation instead of inventing support.`

export const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string', description: '2-4 plain-English sentences explaining the row' },
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
  required: ['explanation', 'citations'],
  additionalProperties: false,
}

export function explainUserMessage({ row, chunksBlock, correction }) {
  const base = `Interpretation table row (JSON):
${JSON.stringify({
    level: row.employeeLevel,
    category: row.categoryLabel,
    title: row.title,
    interpretation: row.plainLanguage,
    value: row.valueLabel,
    employment: row.employment || 'all',
    conditions: row.conditionsText || '',
    clauseRef: row.clauseRef,
  }, null, 2)}

Official award clause text:
${chunksBlock}

Explain this row.`
  if (!correction) return base
  return `${base}

IMPORTANT CORRECTION — your previous answer failed verification: ${correction}
Re-answer with quotes copied character-for-character from the clause text above.`
}
