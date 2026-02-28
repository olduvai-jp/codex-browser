<script setup lang="ts">
import type { TimelineItem } from '@/types'
import ConversationTimeline from './ConversationTimeline.vue'

defineProps<{
  timelineItems: TimelineItem[]
  currentApprovalRequestId?: string | null
  currentToolUserInputRequestId?: string | null
}>()
</script>

<template>
  <ConversationTimeline
    :timeline-items="timelineItems"
    :current-approval-request-id="currentApprovalRequestId"
    :current-tool-user-input-request-id="currentToolUserInputRequestId"
  />
</template>
