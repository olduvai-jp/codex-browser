<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useBridgeClient } from './composables/useBridgeClient'
import AppHeader from './components/header/AppHeader.vue'
import ThreadSidebar from './components/sidebar/ThreadSidebar.vue'
import MessageList from './components/chat/MessageList.vue'
import ChatComposer from './components/chat/ChatComposer.vue'
import AdvancedPanel from './components/advanced/AdvancedPanel.vue'
import ApprovalModal from './components/approval/ApprovalModal.vue'
import ToolUserInputModal from './components/tool/ToolUserInputModal.vue'

const {
  resolvedWsUrl,
  connectionState,
  initialized,
  userAgent,
  activeThreadId,
  resumeThreadId,
  selectedHistoryThreadId,
  messageInput,
  currentTurnId,
  turnStatus,
  threadHistory,
  modelOptions,
  selectedModelId,
  selectedThinkingEffort,
  configSnapshot,
  userGuidance,
  logs,
  toolCalls,
  toolUserInputRequests,
  approvals,
  timelineItems,
  historyResumeAttemptCount,
  historyResumeSuccessCount,
  approvalDecisionCount,
  turnStartCount,
  turnStartWithModelCount,
  isConnected,
  isTurnActive,
  canStartThread,
  canResumeThread,
  canSendMessage,
  canInterruptTurn,
  currentToolUserInputRequest,
  currentApproval,
  sendStateHint,
  currentApprovalExplanation,
  firstSendDurationLabel,
  historyResumeRateLabel,
  approvalDecisionAverageLabel,
  modelSelectionRateLabel,
  availableThinkingEfforts,
  connect,
  disconnect,
  quickStartConversation,
  startThread,
  loadThreadHistory,
  resumeThread,
  sendTurn,
  interruptTurn,
  setSelectedModelId,
  setSelectedThinkingEffort,
  loadConfig,
  respondToToolUserInput,
  cancelToolUserInputRequest,
  respondToApproval,
} = useBridgeClient()

const sidebarOpen = ref(false)

onMounted(() => {
  quickStartConversation()
})
</script>

<template>
  <div class="flex h-screen flex-col bg-surface text-text-primary">
    <!-- Header -->
    <AppHeader
      :connection-state="connectionState"
      :is-connected="isConnected"
      :user-guidance="userGuidance"
      :sidebar-open="sidebarOpen"
      @connect="connect"
      @disconnect="disconnect()"
      @toggle-sidebar="sidebarOpen = !sidebarOpen"
    />

    <!-- Main Area -->
    <div class="flex min-h-0 flex-1 bg-surface">
      <!-- Sidebar -->
      <div
        id="thread-sidebar"
        class="w-72 shrink-0 border-r border-border-default bg-surface-secondary/70 transition-all duration-200"
        :class="sidebarOpen ? 'max-md:fixed max-md:inset-y-16 max-md:left-0 max-md:z-40 max-md:shadow-lg' : 'max-md:hidden'"
      >
        <ThreadSidebar
          :threads="threadHistory"
          :selected-thread-id="selectedHistoryThreadId"
          :active-thread-id="activeThreadId"
          :can-refresh="isConnected && initialized"
          :is-turn-active="isTurnActive"
          @refresh="loadThreadHistory"
          @open-thread="resumeThread($event)"
          @new-thread="startThread"
        />
      </div>

      <!-- Overlay for mobile sidebar -->
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 z-30 bg-black/30 md:hidden"
        @click="sidebarOpen = false"
      />

      <!-- Chat Area -->
      <div class="flex min-w-0 flex-1 flex-col bg-surface">
        <MessageList
          :timeline-items="timelineItems"
          :current-approval-request-id="currentApproval ? String(currentApproval.id) : null"
          :current-tool-user-input-request-id="currentToolUserInputRequest ? String(currentToolUserInputRequest.id) : null"
        />
        <ChatComposer
          :model-value="messageInput"
          :can-send="canSendMessage"
          :can-interrupt="canInterruptTurn"
          :send-hint="sendStateHint"
          :hint-ready="canSendMessage"
          :disabled="!isConnected || !initialized || !activeThreadId || isTurnActive"
          :settings-disabled="!isConnected || !initialized"
          :model-options="modelOptions"
          :selected-model-id="selectedModelId"
          :selected-thinking-effort="selectedThinkingEffort"
          :thinking-options="availableThinkingEfforts"
          @update:model-value="messageInput = $event"
          @update:selected-model-id="setSelectedModelId"
          @update:selected-thinking-effort="setSelectedThinkingEffort"
          @send="sendTurn"
          @interrupt="interruptTurn"
        />
      </div>
    </div>

    <!-- Advanced Panel -->
    <AdvancedPanel
      :can-start-thread="canStartThread"
      :resume-thread-id="resumeThreadId"
      :can-resume-thread="canResumeThread"
      :is-connected="isConnected"
      :initialized="initialized"
      :selected-model-id="selectedModelId"
      :config-snapshot="configSnapshot"
      :logs="logs"
      :tool-calls="toolCalls"
      :connection-state="connectionState"
      :resolved-ws-url="resolvedWsUrl"
      :user-agent="userAgent"
      :active-thread-id="activeThreadId"
      :current-turn-id="currentTurnId"
      :turn-status="turnStatus"
      :first-send-duration-label="firstSendDurationLabel"
      :history-resume-success-count="historyResumeSuccessCount"
      :history-resume-attempt-count="historyResumeAttemptCount"
      :history-resume-rate-label="historyResumeRateLabel"
      :approval-decision-count="approvalDecisionCount"
      :approval-decision-average-label="approvalDecisionAverageLabel"
      :turn-start-with-model-count="turnStartWithModelCount"
      :turn-start-count="turnStartCount"
      :model-selection-rate-label="modelSelectionRateLabel"
      @start-thread="startThread"
      @update:resume-thread-id="resumeThreadId = $event"
      @resume-thread="resumeThread"
      @load-config="loadConfig"
    />

    <!-- Approval Modal -->
    <ApprovalModal
      v-if="currentApproval"
      :approval="currentApproval"
      :explanation="currentApprovalExplanation"
      :queue-size="approvals.length"
      @respond="respondToApproval"
    />

    <!-- Tool User Input Modal -->
    <ToolUserInputModal
      v-if="currentToolUserInputRequest"
      :request="currentToolUserInputRequest"
      :queue-size="toolUserInputRequests.length"
      @submit="respondToToolUserInput"
      @cancel="cancelToolUserInputRequest"
    />
  </div>
</template>
