import { describe, expect, it } from 'vitest'

import { parseModelList } from '@/lib/parsers'

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
})
