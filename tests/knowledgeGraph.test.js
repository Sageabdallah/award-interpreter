import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { buildAwardGraph, classificationFamily, matchCitedNodeIds, normalizeToNodeRef, parseRefList } from '../src/domain/knowledgeGraph.js'

const LIBRARY_DIR = new URL('../src/domain/awardLibrary/healthcare/', import.meta.url)
const ALL_AWARDS = fs.readdirSync(LIBRARY_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => [file.replace('.json', ''), JSON.parse(fs.readFileSync(new URL(file, LIBRARY_DIR), 'utf8'))])

describe('normalizeToNodeRef', () => {
  it('maps sub-clause citations to their top-level clause', () => {
    expect(normalizeToNodeRef('cl. 28.1(b)')).toBe('cl. 28')
    expect(normalizeToNodeRef('cl.19')).toBe('cl. 19')
    expect(normalizeToNodeRef('cl. 13')).toBe('cl. 13')
  })

  it('maps schedule citations to the schedule node', () => {
    expect(normalizeToNodeRef('Sch B.2')).toBe('Sch B')
    expect(normalizeToNodeRef('Schedule C')).toBe('Sch C')
  })

  it('passes through anything unrecognised', () => {
    expect(normalizeToNodeRef('NES s.87')).toBe('NES s.87')
  })
})

describe('parseRefList', () => {
  it('splits slash-separated reference lists', () => {
    expect(parseRefList('cl. 17 / Sch C')).toEqual(['cl. 17', 'Sch C'])
    expect(parseRefList('')).toEqual([])
  })
})

describe('buildAwardGraph on the Nurses Award', () => {
  const graph = buildAwardGraph(ma000034)
  const byType = (type) => graph.nodes.filter((node) => node.type === type)

  it('has one award node carrying the title and code', () => {
    expect(byType('award')).toHaveLength(1)
    expect(byType('award')[0]).toMatchObject({ id: 'award', label: 'Nurses Award 2020', awardCode: 'MA000034' })
  })

  it('has a clause node per clause-index entry, in clause order', () => {
    const clauses = byType('clause')
    expect(clauses.length).toBeGreaterThanOrEqual(41)
    const numbered = clauses.filter((node) => /^cl\. \d+$/.test(node.ref)).map((node) => Number(node.ref.slice(4)))
    expect(numbered).toEqual([...numbered].sort((a, b) => a - b))
    expect(clauses.find((node) => node.ref === 'cl. 2')?.label).toBe('Definitions')
  })

  it('creates topics from the references and edges them to their clauses', () => {
    const topics = byType('topic')
    expect(topics.map((node) => node.id)).toContain('topic:baseRate')
    // eveningNight is blank in this award — no node for it
    expect(topics.map((node) => node.id)).not.toContain('topic:eveningNight')
    const penaltiesEdges = graph.edges.filter((edge) => edge.from === 'topic:penalties')
    expect(penaltiesEdges).toEqual([{ from: 'topic:penalties', to: 'clause:cl. 28' }])
  })

  it('creates clause nodes for referenced schedules missing from the index', () => {
    // allowances = "cl. 17 / Sch C"
    const allowanceTargets = graph.edges.filter((edge) => edge.from === 'topic:allowances').map((edge) => edge.to)
    expect(allowanceTargets).toContain('clause:cl. 17')
    expect(allowanceTargets).toContain('clause:Sch C')
    expect(graph.nodes.some((node) => node.id === 'clause:Sch C')).toBe(true)
  })

  it('groups classification levels into streams with rate ranges', () => {
    const streams = byType('stream')
    expect(streams.length).toBeGreaterThan(0)
    const total = streams.reduce((sum, node) => sum + node.levelCount, 0)
    expect(total).toBe(21)
    for (const stream of streams) {
      expect(stream.rateMin).toBeGreaterThan(0)
      expect(stream.rateMax).toBeGreaterThanOrEqual(stream.rateMin)
      expect(graph.edges).toContainEqual({ from: 'award', to: stream.id })
    }
  })

  it('every edge endpoint exists as a node', () => {
    const ids = new Set(graph.nodes.map((node) => node.id))
    for (const edge of graph.edges) {
      expect(ids.has(edge.from)).toBe(true)
      expect(ids.has(edge.to)).toBe(true)
    }
  })
})

describe('classificationFamily', () => {
  it('collapses level and year-of-service variants to the family', () => {
    expect(classificationFamily('Registered nurse—level 2 — In excess of 3 years of employment classified at this level')).toBe('Registered nurse')
    expect(classificationFamily('Aged care employee—general—level 3')).toBe('Aged care employee')
    expect(classificationFamily('Pharmacy assistant level 1')).toBe('Pharmacy assistant')
  })

  it('strips trailing salary figures but keeps level numbers as a fallback', () => {
    expect(classificationFamily('Intern 66,432')).toBe('Intern')
    expect(classificationFamily('Level 5 (unqualified with 12 months’ industry experience)')).toBe('Level 5')
  })
})

describe('buildAwardGraph across the whole award library', () => {
  it.each(ALL_AWARDS)('%s builds a well-formed graph', (code, entry) => {
    const graph = buildAwardGraph(entry)
    const byType = (type) => graph.nodes.filter((node) => node.type === type)
    expect(byType('award')).toHaveLength(1)
    expect(byType('award')[0].awardCode).toBe(code)
    expect(byType('clause').length).toBeGreaterThan(20)
    expect(byType('topic').length).toBeGreaterThan(0)

    // Streams: every level accounted for, grouped tighter than one-per-level.
    const streams = byType('stream')
    const levelCount = (entry.parsedAward.levels || []).length
    expect(streams.reduce((sum, node) => sum + node.levelCount, 0)).toBe(levelCount)
    expect(streams.length).toBeLessThan(levelCount)

    // Every edge endpoint resolves; ids are unique.
    const ids = graph.nodes.map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    const idSet = new Set(ids)
    for (const edge of graph.edges) {
      expect(idSet.has(edge.from)).toBe(true)
      expect(idSet.has(edge.to)).toBe(true)
    }
  })
})

describe('matchCitedNodeIds', () => {
  const graph = buildAwardGraph(ma000034)

  it('maps cited sub-clauses onto the graph clause nodes', () => {
    const matched = matchCitedNodeIds(graph, ['cl. 28.1(b)', 'cl. 19', 'Sch B.2'])
    expect(matched.has('clause:cl. 28')).toBe(true)
    expect(matched.has('clause:cl. 19')).toBe(true)
    expect(matched.has('clause:Sch B')).toBe(true)
  })

  it('ignores refs with no node and empty input', () => {
    expect(matchCitedNodeIds(graph, ['cl. 999']).size).toBe(0)
    expect(matchCitedNodeIds(graph, []).size).toBe(0)
    expect(matchCitedNodeIds(graph, undefined).size).toBe(0)
  })
})
