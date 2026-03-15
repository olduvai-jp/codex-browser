<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useBridgeClient } from './composables/useBridgeClient'
import AppHeader from './components/header/AppHeader.vue'
import ThreadSidebar from './components/sidebar/ThreadSidebar.vue'
import MessageList from './components/chat/MessageList.vue'
import ChatComposer from './components/chat/ChatComposer.vue'
import AdvancedPanel from './components/advanced/AdvancedPanel.vue'
import ApprovalModal from './components/approval/ApprovalModal.vue'
import ToolUserInputModal from './components/tool/ToolUserInputModal.vue'
import WorkspacePicker from './components/workspace/WorkspacePicker.vue'

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
  workspaceHistoryGroups,
  modelOptions,
  selectedModelId,
  selectedThinkingEffort,
  configSnapshot,
  userGuidance,
  logs,
  toolCalls,
  executionModeCurrentPreset,
  selectedExecutionModePreset,
  executionModeRequirements,
  isExecutionModeSaving,
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
  listDirectories,
  loadThreadHistory,
  resumeThread,
  sendTurn,
  interruptTurn,
  setSelectedModelId,
  setSelectedThinkingEffort,
  setSelectedExecutionModePreset,
  saveExecutionModeConfig,
  loadConfig,
  respondToToolUserInput,
  cancelToolUserInputRequest,
  respondToApproval,
  bridgeCwd,
} = useBridgeClient()

const sidebarOpen = ref(true)
const advancedPanelOpen = ref(false)
const workspacePickerOpen = ref(false)

const currentModelLabel = computed(() => {
  if (!selectedModelId.value) return ''
  const option = modelOptions.value.find((o) => o.id === selectedModelId.value)
  return option?.label ?? selectedModelId.value
})

function handleWorkspaceSelect(cwd: string): void {
  startThread(cwd)
  workspacePickerOpen.value = false
}

onMounted(() => {
  quickStartConversation()
})
</script>

<template>
  <div class="flex h-screen bg-chat-bg text-text-primary">
    <!-- Sidebar -->
    <div
      v-if="sidebarOpen"
      id="thread-sidebar"
      class="flex w-[260px] shrink-0 flex-col bg-sidebar-bg transition-all duration-200 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-lg"
    >
      <ThreadSidebar
        :workspace-groups="workspaceHistoryGroups"
        :selected-thread-id="selectedHistoryThreadId"
        :active-thread-id="activeThreadId"
        :can-refresh="isConnected && initialized"
        :is-turn-active="isTurnActive"
        :advanced-panel-open="advancedPanelOpen"
        :is-connected="isConnected"
        :connection-state="connectionState"
        @refresh="loadThreadHistory"
        @open-thread="resumeThread($event)"
        @new-thread="startThread()"
        @new-thread-in-workspace="startThread($event)"
        @open-workspace-picker="workspacePickerOpen = true"
        @toggle-advanced-panel="advancedPanelOpen = !advancedPanelOpen"
        @toggle-sidebar="sidebarOpen = false"
        @connect="connect"
        @disconnect="disconnect()"
      />
    </div>

    <!-- Overlay for mobile sidebar -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-black/30 md:hidden"
      @click="sidebarOpen = false"
    />

    <!-- Chat Area -->
    <div class="flex min-w-0 flex-1 flex-col bg-chat-bg">
      <!-- Top Bar -->
      <AppHeader
        :sidebar-open="sidebarOpen"
        :user-guidance="userGuidance"
        :model-label="currentModelLabel"
        @toggle-sidebar="sidebarOpen = !sidebarOpen"
        @new-thread="startThread()"
      />

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
        :current-execution-mode-preset="executionModeCurrentPreset"
        :selected-execution-mode-preset="selectedExecutionModePreset"
        :execution-mode-requirements="executionModeRequirements"
        :execution-mode-saving="isExecutionModeSaving"
        @update:model-value="messageInput = $event"
        @update:selected-model-id="setSelectedModelId"
        @update:selected-thinking-effort="setSelectedThinkingEffort"
        @update:selected-execution-mode-preset="setSelectedExecutionModePreset"
        @save-execution-mode-config="saveExecutionModeConfig"
        @send="sendTurn"
        @interrupt="interruptTurn"
      />
    </div>

    <!-- Advanced Panel -->
    <AdvancedPanel
      :open="advancedPanelOpen"
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
      @start-thread="startThread()"
      @update:resume-thread-id="resumeThreadId = $event"
      @resume-thread="resumeThread"
      @load-config="loadConfig"
      @close="advancedPanelOpen = false"
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

    <!-- Workspace Picker Modal -->
    <WorkspacePicker
      v-if="workspacePickerOpen"
      :initial-path="bridgeCwd || '/'"
      :list-directories="listDirectories"
      @select="handleWorkspaceSelect"
      @cancel="workspacePickerOpen = false"
    />
  </div>
</template>
