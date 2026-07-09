const KINDS = new Set(['explain-row', 'classify-employee'])

/**
 * POST /api/feedback  { kind, helpful, awardCode?, rowId?, note? }
 * → { recorded: boolean }
 *
 * Deliberately thin. Its job is to append one line to an eval set that does not
 * exist yet and cannot be reconstructed later — not to be a review workflow.
 */
export function feedbackRoute({ telemetry }) {
  return async (req, res) => {
    const { kind, helpful, awardCode, rowId, note } = req.body || {}

    if (!KINDS.has(kind)) {
      return res.status(400).json({ error: `kind must be one of: ${[...KINDS].join(', ')}` })
    }
    if (typeof helpful !== 'boolean') {
      return res.status(400).json({ error: 'helpful must be a boolean' })
    }
    if (note != null && (typeof note !== 'string' || note.length > 2000)) {
      return res.status(400).json({ error: 'note must be a string of at most 2000 characters' })
    }

    telemetry.feedback({ kind, awardCode, rowId, helpful, note })
    // Telemetry may be disabled (no LOG_DIR); the client does not need to care.
    return res.json({ recorded: Boolean(telemetry.dir) })
  }
}
