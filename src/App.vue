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
import SlashCommandPickerModal from './components/slash/SlashCommandPickerModal.vue'
import { logoutBrowserAuth, readBrowserAuthSession } from './lib/browserAuth'
import { EXECUTION_MODE_SELECTABLE_PRESET_VALUES, type ExecutionModeSelectablePreset } from './types'

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
  collaborationModes,
  selectedCollaborationMode,
  configSnapshot,
  userGuidance,
  historyDisplayMode,
  historyLoading,
  logs,
  toolCalls,
  executionModeCurrentPreset,
  selectedExecutionModePreset,
  executionModeRequirements,
  isExecutionModeSaving,
  isSlashModelPickerOpen,
  isSlashPermissionsPickerOpen,
  activeSlashSuggestionIndex,
  toolUserInputRequests,
  approvals,
  planImplementationPromptOpen,
  isPlanImplementationStarting,
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
  slashSuggestions,
  slashSuggestionsOpen,
  canInterruptTurn,
  historyCanLoadMore,
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
  loadMoreThreadHistory,
  setHistoryDisplayMode,
  resumeThread,
  sendTurn,
  interruptTurn,
  setSelectedModelId,
  setSelectedThinkingEffort,
  setSelectedCollaborationMode,
  setSelectedExecutionModePreset,
  saveExecutionModeConfig,
  moveSlashSuggestionSelection,
  commitActiveSlashSuggestion,
  closeSlashSuggestions,
  selectSlashSuggestionById,
  closeSlashModelPicker,
  selectSlashModelFromPicker,
  closeSlashPermissionsPicker,
  selectSlashPermissionsPresetFromPicker,
  implementPlanFromPrompt,
  continuePlanModeFromPrompt,
  cancelPlanImplementationPrompt,
  loadConfig,
  respondToToolUserInput,
  cancelToolUserInputRequest,
  respondToApproval,
  bridgeCwd,
} = useBridgeClient()

const sidebarOpen = ref(true)
const advancedPanelOpen = ref(false)
const workspacePickerOpen = ref(false)
const authEnabled = ref(false)

const currentModelLabel = computed(() => {
  if (!selectedModelId.value) return ''
  const option = modelOptions.value.find((o) => o.id === selectedModelId.value)
  return option?.label ?? selectedModelId.value
})

const slashModelPickerOptions = computed(() =>
  modelOptions.value.map((option) => ({
    id: option.id,
    label: option.label,
    description:
      option.supportedReasoningEfforts && option.supportedReasoningEfforts.length > 0
        ? `effort: ${option.supportedReasoningEfforts.join(', ')}`
        : undefined,
  })),
)

function isSlashPermissionPresetAllowed(preset: ExecutionModeSelectablePreset): boolean {
  if (preset === 'read-only') {
    return (
      executionModeRequirements.value.allowedApprovalPolicies.includes('on-request') &&
      executionModeRequirements.value.allowedSandboxModes.includes('read-only')
    )
  }
  if (preset === 'auto') {
    return (
      executionModeRequirements.value.allowedApprovalPolicies.includes('on-request') &&
      executionModeRequirements.value.allowedSandboxModes.includes('workspace-write')
    )
  }

  return (
    executionModeRequirements.value.allowedApprovalPolicies.includes('never') &&
    executionModeRequirements.value.allowedSandboxModes.includes('danger-full-access')
  )
}

const slashPermissionPickerOptions = computed(() =>
  EXECUTION_MODE_SELECTABLE_PRESET_VALUES.map((preset) => ({
    id: preset,
    label: preset,
    description:
      preset === 'read-only'
        ? 'on-request + read-only'
        : preset === 'auto'
          ? 'on-request + workspace-write'
          : 'never + danger-full-access',
    disabled: !isSlashPermissionPresetAllowed(preset),
  })),
)

function handleWorkspaceSelect(cwd: string): void {
  startThread(cwd)
  workspacePickerOpen.value = false
}

async function handleConnect(): Promise<void> {
  await connect()
  if (!isConnected.value || !initialized.value) {
    return
  }
  await quickStartConversation()
}

async function handleLogout(): Promise<void> {
  await logoutBrowserAuth()
  disconnect()
  window.dispatchEvent(new CustomEvent('codex-browser-auth-logout'))
}

onMounted(() => {
  void quickStartConversation()

  void (async () => {
    const session = await readBrowserAuthSession()
    authEnabled.value = session.authEnabled && session.authenticated
  })()
})
</script>

<template>
  <div class="safe-area-top flex h-dvh bg-chat-bg text-text-primary">
    <!-- Sidebar -->
    <Transition name="sidebar-slide">
      <div
        v-if="sidebarOpen"
        id="thread-sidebar"
        class="flex w-[260px] shrink-0 flex-col bg-sidebar-bg transition-all duration-200 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-lg"
      >
        <ThreadSidebar
          :workspace-groups="workspaceHistoryGroups"
          :selected-thread-id="selectedHistoryThreadId"
          :active-thread-id="activeThreadId"
          :history-display-mode="historyDisplayMode"
          :can-refresh="isConnected && initialized"
          :history-loading="historyLoading"
          :can-load-more-history="historyCanLoadMore"
          :is-turn-active="isTurnActive"
          :advanced-panel-open="advancedPanelOpen"
          :is-connected="isConnected"
          :connection-state="connectionState"
          @refresh="loadThreadHistory"
          @set-history-display-mode="setHistoryDisplayMode"
          @load-more-history="loadMoreThreadHistory"
          @open-thread="resumeThread($event)"
          @new-thread="startThread()"
          @new-thread-in-workspace="startThread($event)"
          @open-workspace-picker="workspacePickerOpen = true"
          @toggle-advanced-panel="advancedPanelOpen = !advancedPanelOpen"
          @toggle-sidebar="sidebarOpen = false"
          @connect="handleConnect"
          @disconnect="disconnect()"
        />
      </div>
    </Transition>

    <!-- Overlay for mobile sidebar -->
    <Transition name="sidebar-overlay">
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 z-30 bg-black/30 md:hidden"
        @click="sidebarOpen = false"
      />
    </Transition>

    <!-- Chat Area -->
    <div class="flex min-w-0 flex-1 flex-col bg-chat-bg">
      <!-- Top Bar -->
      <AppHeader
        :sidebar-open="sidebarOpen"
        :user-guidance="userGuidance"
        :model-label="currentModelLabel"
        :show-logout="authEnabled"
        @toggle-sidebar="sidebarOpen = !sidebarOpen"
        @new-thread="startThread()"
        @logout="handleLogout"
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
        :disabled="!isConnected || !initialized"
        :settings-disabled="!isConnected || !initialized"
        :model-options="modelOptions"
        :selected-model-id="selectedModelId"
        :selected-thinking-effort="selectedThinkingEffort"
        :selected-collaboration-mode="selectedCollaborationMode"
        :collaboration-modes="collaborationModes"
        :thinking-options="availableThinkingEfforts"
        :current-execution-mode-preset="executionModeCurrentPreset"
        :selected-execution-mode-preset="selectedExecutionModePreset"
        :execution-mode-requirements="executionModeRequirements"
        :execution-mode-saving="isExecutionModeSaving"
        :slash-suggestions-open="slashSuggestionsOpen"
        :slash-suggestions="slashSuggestions"
        :active-slash-suggestion-index="activeSlashSuggestionIndex"
        :plan-implementation-prompt-open="planImplementationPromptOpen"
        :plan-implementation-starting="isPlanImplementationStarting"
        @update:model-value="messageInput = $event"
        @update:selected-model-id="setSelectedModelId"
        @update:selected-thinking-effort="setSelectedThinkingEffort"
        @update:selected-collaboration-mode="setSelectedCollaborationMode"
        @update:selected-execution-mode-preset="setSelectedExecutionModePreset"
        @save-execution-mode-config="saveExecutionModeConfig"
        @slash-move-selection="moveSlashSuggestionSelection"
        @slash-commit-selection="commitActiveSlashSuggestion"
        @slash-close-suggestions="closeSlashSuggestions"
        @slash-select-suggestion="selectSlashSuggestionById"
        @implement-plan="implementPlanFromPrompt"
        @continue-plan-mode="continuePlanModeFromPrompt"
        @cancel-plan-implementation-prompt="cancelPlanImplementationPrompt"
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

    <SlashCommandPickerModal
      v-if="isSlashModelPickerOpen"
      title="モデルを選択"
      subtitle="`/model` の引数なし実行で開きます。"
      :options="slashModelPickerOptions"
      :selected-id="selectedModelId"
      empty-label="利用可能なモデルがありません。"
      @select="selectSlashModelFromPicker"
      @cancel="closeSlashModelPicker"
    />

    <SlashCommandPickerModal
      v-if="isSlashPermissionsPickerOpen"
      title="権限プリセットを選択"
      subtitle="`/permissions` または `/approvals` の引数なし実行で開きます。"
      :options="slashPermissionPickerOptions"
      :selected-id="selectedExecutionModePreset"
      @select="selectSlashPermissionsPresetFromPicker"
      @cancel="closeSlashPermissionsPicker"
    />
  </div>
</template>
