// Smoke render for the award knowledge graph SVG: must render (not throw,
// not blank) from the real Nurses Award library entry, and reflect cited
// clauses in the highlight legend.
import fs from 'node:fs'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { AwardKnowledgeGraph } from '../src/shell/AwardKnowledgeGraph.jsx'
import { buildAwardGraph, matchCitedNodeIds } from '../src/domain/knowledgeGraph.js'

const graph = buildAwardGraph(ma000034)

// React SSR interleaves <!-- --> markers between adjacent text expressions.
const renderPlain = (element) => renderToString(element).replace(/<!--.*?-->/g, '')

describe('AwardKnowledgeGraph', () => {
  it('renders the award centre, clause ring and inner pills', () => {
    const html = renderPlain(<AwardKnowledgeGraph graph={graph} citedIds={new Set()} />)
    expect(html).toContain('<svg')
    expect(html).toContain('MA000034')
    expect(html).toContain('Penalty rates')
    // one dot per clause node
    const clauseCount = graph.nodes.filter((node) => node.type === 'clause').length
    expect(html).toContain(`clause (${clauseCount})`)
    expect(html).not.toContain('NaN')
  })

  it('highlights cited clauses and says so in the legend', () => {
    const cited = matchCitedNodeIds(graph, ['cl. 28.1', 'cl. 19'])
    const html = renderPlain(<AwardKnowledgeGraph graph={graph} citedIds={cited} />)
    expect(html).toContain('cited in the last answer (2)')
    expect(html).toContain('<animate')
  })

  it('renders every award in the library without NaN coordinates or runaway labels', () => {
    const dir = new URL('../src/domain/awardLibrary/healthcare/', import.meta.url)
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
      const entry = JSON.parse(fs.readFileSync(new URL(file, dir), 'utf8'))
      const html = renderPlain(<AwardKnowledgeGraph graph={buildAwardGraph(entry)} citedIds={new Set()} />)
      expect(html, file).toContain('<svg')
      expect(html, file).not.toContain('NaN')
      // Pills truncate long family names; nothing longer than ~30 chars renders.
      const pillLabels = [...html.matchAll(/<text[^>]*text-anchor="middle" font-size="10"[^>]*>([^<]*)</g)].map((match) => match[1])
      expect(pillLabels.length, file).toBeGreaterThan(0)
      for (const label of pillLabels) expect(label.length, `${file}: ${label}`).toBeLessThanOrEqual(31)
    }
  })
})
