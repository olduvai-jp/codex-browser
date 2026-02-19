<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useBridgeClient } from './composables/useBridgeClient'
import AppHeader from './components/header/AppHeader.vue'
import ThreadSidebar from './components/sidebar/ThreadSidebar.vue'
import MessageList from './components/chat/MessageList.vue'
import ChatComposer from './components/chat/ChatComposer.vue'
import AdvancedPanel from './components/advanced/AdvancedPanel.vue'
import ApprovalModal from './components/approval/ApprovalModal.vue'

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
  configSnapshot,
  userGuidance,
  messages,
  logs,
  approvals,
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
  currentApproval,
  sendStateHint,
  currentApprovalExplanation,
  firstSendDurationLabel,
  historyResumeRateLabel,
  approvalDecisionAverageLabel,
  modelSelectionRateLabel,
  connect,
  disconnect,
  quickStartConversation,
  startThread,
  loadThreadHistory,
  resumeThread,
  sendTurn,
  interruptTurn,
  loadModelList,
  loadConfig,
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
    <div class="flex min-h-0 flex-1">
      <!-- Sidebar -->
      <div
        class="w-64 shrink-0 transition-all duration-200"
        :class="sidebarOpen ? 'max-md:fixed max-md:inset-y-14 max-md:left-0 max-md:z-40' : 'max-md:hidden'"
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
      <div class="flex min-w-0 flex-1 flex-col">
        <MessageList :messages="messages" />
        <ChatComposer
          :model-value="messageInput"
          :can-send="canSendMessage"
          :can-interrupt="canInterruptTurn"
          :send-hint="sendStateHint"
          :hint-ready="canSendMessage"
          :disabled="!isConnected || !initialized || !activeThreadId || isTurnActive"
          @update:model-value="messageInput = $event"
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
      :model-options="modelOptions"
      :selected-model-id="selectedModelId"
      :config-snapshot="configSnapshot"
      :logs="logs"
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
      @load-model-list="loadModelList"
      @update:selected-model-id="selectedModelId = $event"
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
  </div>
</template>
