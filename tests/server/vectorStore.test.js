import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openVectorStore } from '../../server/rag/vectorStore.js'

const directories = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('optional vector store', () => {
  it('keeps the ERP backend available when no local RAG index exists', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'axi-no-rag-'))
    directories.push(directory)
    const log = vi.fn()
    const store = await openVectorStore({ indexDir: directory, log })

    expect(store.backend).toBe('disabled')
    expect(await store.search({ vector: [] })).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/core ERP routes remain available/i))
  })
})
