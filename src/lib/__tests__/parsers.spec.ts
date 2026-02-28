import { describe, expect, it } from 'vitest'

import { parseModelList, parseThreadHistoryList } from '@/lib/parsers'

describe('parseModelList reasoning effort aliases', () => {
  it('falls back to later default effort aliases when an earlier key is invalid', () => {
    const parsed = parseModelList({
      data: {
        items: [
          {
            model: {
              id: 'model-default-alias',
              defaultReasoningEffort: 'invalid',
              reasoningEffort: 'high',
            },
          },
        ],
      },
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 'model-default-alias',
      defaultReasoningEffort: 'high',
    })
  })

  it('falls back to later supported effort aliases when an earlier key has no valid values', () => {
    const parsed = parseModelList({
      models: [
        {
          id: 'model-list-alias',
          supportedReasoningEfforts: ['invalid-only'],
          reasoningEfforts: ['low', 'invalid', 'high'],
        },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 'model-list-alias',
      supportedReasoningEfforts: ['low', 'high'],
    })
  })

  it('extracts explicit model default flag', () => {
    const parsed = parseModelList({
      data: {
        items: [
          {
            model: {
              id: 'model-default-flag',
              isDefault: true,
            },
          },
        ],
      },
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 'model-default-flag',
      isServerDefault: true,
    })
  })
})

describe('parseThreadHistoryList title normalization', () => {
  it('uses candidate keys like preview and does not fall back to UUID id when preview exists', () => {
    const parsed = parseThreadHistoryList({
      threads: [
        {
          id: '6f27fa33-7059-4f8e-b935-fc835f14f414',
          preview: 'Preview title from history',
        },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: '6f27fa33-7059-4f8e-b935-fc835f14f414',
      title: 'Preview title from history',
    })
  })

  it('treats non-hyphen 32-char hex UUID as invalid title candidate and falls back to id', () => {
    const parsed = parseThreadHistoryList({
      threads: [
        {
          id: 'thread-fallback-non-hyphen-uuid',
          title: '6f27fa3370594f8eb935fc835f14f414',
        },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 'thread-fallback-non-hyphen-uuid',
      title: 'thread-fallback-non-hyphen-uuid',
    })
  })

  it('treats upper-case non-hyphen 32-char hex UUID as invalid title candidate and keeps next candidate', () => {
    const parsed = parseThreadHistoryList({
      threads: [
        {
          id: 'thread-uppercase-uuid-candidate',
          title: '6F27FA3370594F8EB935FC835F14F414',
          preview: 'Preview title remains',
        },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 'thread-uppercase-uuid-candidate',
      title: 'Preview title remains',
    })
  })

  it('keeps a valid title when duplicate ids are merged with a later title-missing entry', () => {
    const parsed = parseThreadHistoryList({
      threads: [
        {
          id: 'thread-duplicate-1',
          title: 'Keep this title',
          turnCount: 3,
          cwd: '/workspace/current',
          source: 'cache',
        },
        {
          id: 'thread-duplicate-1',
          title: '   ',
          updatedAt: '2026-02-28T01:02:03.000Z',
        },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 'thread-duplicate-1',
      title: 'Keep this title',
      updatedAt: '2026-02-28T01:02:03.000Z',
      turnCount: 3,
      cwd: '/workspace/current',
      source: 'cache',
    })
  })

  it('prefers the later valid title when duplicate ids both have valid titles', () => {
    const parsed = parseThreadHistoryList({
      threads: [
        {
          id: 'thread-duplicate-both-valid',
          title: 'Initial title',
          turnCount: 2,
        },
        {
          id: 'thread-duplicate-both-valid',
          title: 'Latest title',
          updatedAt: '2026-02-28T05:00:00.000Z',
        },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 'thread-duplicate-both-valid',
      title: 'Latest title',
      updatedAt: '2026-02-28T05:00:00.000Z',
      turnCount: 2,
    })
  })

  it('falls back to id only when every title candidate is missing or blank', () => {
    const parsed = parseThreadHistoryList({
      threads: [
        {
          id: 'thread-fallback-1',
          title: '   ',
          name: '',
          summary: ' \n\t ',
          preview: '\t',
        },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 'thread-fallback-1',
      title: 'thread-fallback-1',
    })
  })
})
