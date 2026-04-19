import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import ConversationTimeline from './ConversationTimeline.vue'
import type { TimelineItem, UiMessage } from '@/types'

function createMessageItem(options: {
  id: string
  sequence: number
  text: string
  role?: UiMessage['role']
  streaming?: boolean
}): TimelineItem {
  return {
    id: options.id,
    kind: 'message',
    timelineSequence: options.sequence,
    message: {
      id: `${options.id}-message`,
      role: options.role ?? 'assistant',
      text: options.text,
      streaming: options.streaming ?? false,
      assistantUtteranceStarted: true,
    },
  }
}

function mountTimeline(timelineItems: TimelineItem[]) {
  return mount(ConversationTimeline, {
    props: {
      timelineItems,
      currentApprovalRequestId: null,
      currentToolUserInputRequestId: null,
    },
  })
}

function createToolItem(options: {
  id: string
  sequence: number
  status?: 'inProgress' | 'completed' | 'failed'
  outputText?: string
}): TimelineItem {
  return {
    id: options.id,
    kind: 'tool',
    timelineSequence: options.sequence,
    toolCall: {
      id: `${options.id}-call`,
      toolName: 'commandExecution',
      status: options.status ?? 'completed',
      outputText: options.outputText ?? '',
      startedAt: '2026-01-01T00:00:00.000Z',
      events: [],
    },
  }
}

function mockScrollableElement(element: HTMLElement, options: {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}) {
  let currentScrollTop = options.scrollTop
  let currentScrollHeight = options.scrollHeight

  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => options.clientHeight,
  })
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => currentScrollHeight,
  })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => currentScrollTop,
    set: (value: number) => {
      currentScrollTop = value
    },
  })

  const scrollTo = vi.fn((position?: number | ScrollToOptions): void => {
    if (typeof position === 'number') {
      currentScrollTop = position
      return
    }
    if (position && typeof position.top === 'number') {
      currentScrollTop = position.top
    }
  })

  Object.defineProperty(element, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  })

  return {
    scrollTo,
    setScrollTop(value: number): void {
      currentScrollTop = value
    },
    setScrollHeight(value: number): void {
      currentScrollHeight = value
    },
  }
}

describe('ConversationTimeline', () => {
  it('renders markdown and escapes raw HTML content', () => {
    const wrapper = mountTimeline([
      createMessageItem({
        id: 'message-1',
        sequence: 1,
        text: '## Title\n\n- item\n\n<script>alert(1)</script>',
      }),
    ])

    const markdown = wrapper.get('[data-testid="timeline-message-markdown"]')
    expect(markdown.find('h2').exists()).toBe(true)
    expect(markdown.find('ul li').text()).toBe('item')
    expect(markdown.find('script').exists()).toBe(false)
    expect(markdown.text()).toContain('<script>alert(1)</script>')
  })

  it('auto-scrolls when following latest and a new message is appended', async () => {
    const firstItem = createMessageItem({
      id: 'message-1',
      sequence: 1,
      text: 'first',
    })
    const secondItem = createMessageItem({
      id: 'message-2',
      sequence: 2,
      text: 'second',
    })
    const wrapper = mountTimeline([firstItem])
    const scroller = wrapper.get('[data-testid="conversation-timeline-scroll"]')
    const scrollControl = mockScrollableElement(scroller.element as HTMLElement, {
      clientHeight: 300,
      scrollHeight: 600,
      scrollTop: 300,
    })

    await nextTick()
    scrollControl.scrollTo.mockClear()

    scrollControl.setScrollTop(300)
    await scroller.trigger('scroll')

    scrollControl.setScrollHeight(900)
    await wrapper.setProps({ timelineItems: [firstItem, secondItem] })
    await nextTick()

    expect(scrollControl.scrollTo).toHaveBeenCalled()
  })

  it('does not auto-scroll when the user has scrolled up', async () => {
    const firstItem = createMessageItem({
      id: 'message-1',
      sequence: 1,
      text: 'first',
    })
    const secondItem = createMessageItem({
      id: 'message-2',
      sequence: 2,
      text: 'second',
    })
    const wrapper = mountTimeline([firstItem])
    const scroller = wrapper.get('[data-testid="conversation-timeline-scroll"]')
    const scrollControl = mockScrollableElement(scroller.element as HTMLElement, {
      clientHeight: 300,
      scrollHeight: 600,
      scrollTop: 300,
    })

    await nextTick()
    scrollControl.scrollTo.mockClear()

    scrollControl.setScrollTop(40)
    await scroller.trigger('scroll')

    scrollControl.setScrollHeight(900)
    await wrapper.setProps({ timelineItems: [firstItem, secondItem] })
    await nextTick()

    expect(scrollControl.scrollTo).not.toHaveBeenCalled()
  })

  it('auto-scrolls on streaming text growth while following latest', async () => {
    const streamingItem = createMessageItem({
      id: 'message-1',
      sequence: 1,
      text: 'a',
      streaming: true,
    })
    const wrapper = mountTimeline([streamingItem])
    const scroller = wrapper.get('[data-testid="conversation-timeline-scroll"]')
    const scrollControl = mockScrollableElement(scroller.element as HTMLElement, {
      clientHeight: 300,
      scrollHeight: 600,
      scrollTop: 300,
    })

    await nextTick()
    scrollControl.scrollTo.mockClear()

    scrollControl.setScrollTop(300)
    await scroller.trigger('scroll')

    scrollControl.setScrollHeight(780)
    await wrapper.setProps({
      timelineItems: [
        createMessageItem({
          id: 'message-1',
          sequence: 1,
          text: 'abcdef',
          streaming: true,
        }),
      ],
    })
    await nextTick()

    expect(scrollControl.scrollTo).toHaveBeenCalled()
  })

  it('auto-scrolls when an earlier message grows while a later tool item remains last', async () => {
    const initialMessage = createMessageItem({
      id: 'message-1',
      sequence: 1,
      text: 'a',
      streaming: true,
    })
    const toolItem = createToolItem({
      id: 'tool-1',
      sequence: 2,
      status: 'inProgress',
      outputText: 'running',
    })
    const wrapper = mountTimeline([initialMessage, toolItem])
    const scroller = wrapper.get('[data-testid="conversation-timeline-scroll"]')
    const scrollControl = mockScrollableElement(scroller.element as HTMLElement, {
      clientHeight: 300,
      scrollHeight: 600,
      scrollTop: 300,
    })

    await nextTick()
    scrollControl.scrollTo.mockClear()

    scrollControl.setScrollTop(300)
    await scroller.trigger('scroll')

    scrollControl.setScrollHeight(760)
    await wrapper.setProps({
      timelineItems: [
        createMessageItem({
          id: 'message-1',
          sequence: 1,
          text: 'abcdef',
          streaming: true,
        }),
        toolItem,
      ],
    })
    await nextTick()

    expect(scrollControl.scrollTo).toHaveBeenCalled()
  })

  it('renders plan timeline entries with streaming and completed states', async () => {
    const wrapper = mountTimeline([
      {
        id: 'plan-1',
        kind: 'plan',
        timelineSequence: 1,
        turnId: 'turn-1',
        itemId: 'item-plan-1',
        text: 'step 1\nstep 2',
        streaming: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    expect(wrapper.find('[data-testid="timeline-plan-state"]').text()).toContain('計画中...')
    expect(wrapper.text()).toContain('step 1')

    await wrapper.setProps({
      timelineItems: [
        {
          id: 'plan-1',
          kind: 'plan',
          timelineSequence: 1,
          turnId: 'turn-1',
          itemId: 'item-plan-1',
          text: 'step 1\nstep 2\ndone',
          streaming: false,
          updatedAt: '2026-01-01T00:00:01.000Z',
        },
      ],
    })
    await nextTick()

    expect(wrapper.find('[data-testid="timeline-plan-state"]').text()).toContain('完了')
    expect(wrapper.text()).toContain('done')
  })

  it('renders failed turn status details when provided', () => {
    const wrapper = mountTimeline([
      {
        id: 'turn-status-1',
        kind: 'turnStatus',
        timelineSequence: 1,
        turnId: 'turn-error-1',
        status: 'failed',
        label: '応答処理で問題が発生しました: Plan mode failed while strengthening logs',
        occurredAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    expect(wrapper.text()).toContain('Plan mode failed while strengthening logs')
    expect(wrapper.text()).not.toContain('Turn turn-error-1 completed with status')
  })
})
