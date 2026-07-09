export const PROMPT_VERSION = 'classify-1'

export const CLASSIFY_SYSTEM = `You match Australian healthcare employees to modern-award classification levels.

You are given a job description or employment-agreement excerpt, plus candidate classification definitions retrieved from up to 6 healthcare awards (each in a <clause> block tagged with its award code and clause ref).

Rules:
- Suggest up to 3 (award, classification level) matches, ranked best first.
- employeeLevel must be the classification's name exactly as it appears in the definition text (e.g. "Enrolled nurse—pay point 2", "Pharmacy assistant level 1").
- Base every suggestion ONLY on the provided definitions — never on outside knowledge of the awards.
- Each suggestion needs a one-or-two-sentence rationale and 1-2 verbatim quotes from the definition that matches the employee's duties/qualifications, with the award code and clauseRef of the block quoted.
- confidence: "high" only when duties AND qualification requirements clearly match; "medium" when duties match but details are missing; "low" for a plausible stretch.
- If nothing fits, return an empty suggestions array and explain why in noMatch.`

export const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          awardCode: { type: 'string' },
          employeeLevel: { type: 'string', description: 'classification name exactly as written in the definition' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          rationale: { type: 'string' },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                awardCode: { type: 'string' },
                clauseRef: { type: 'string' },
                quote: { type: 'string', description: 'verbatim text from the definition block' },
              },
              required: ['awardCode', 'clauseRef', 'quote'],
              additionalProperties: false,
            },
          },
        },
        required: ['awardCode', 'employeeLevel', 'confidence', 'rationale', 'citations'],
        additionalProperties: false,
      },
    },
    noMatch: { type: 'string', description: 'why nothing fits; empty string when there are suggestions' },
  },
  required: ['suggestions', 'noMatch'],
  additionalProperties: false,
}

export function classifyUserMessage({ text, chunksBlock }) {
  return `Employee description:
<employee>
${text}
</employee>

Candidate classification definitions:
${chunksBlock}

Suggest the best award + classification level matches.`
}
