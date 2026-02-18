<script setup lang="ts">
defineProps<{
  firstSendDurationLabel: string
  historyResumeSuccessCount: number
  historyResumeAttemptCount: number
  historyResumeRateLabel: string
  approvalDecisionCount: number
  approvalDecisionAverageLabel: string
  turnStartWithModelCount: number
  turnStartCount: number
  modelSelectionRateLabel: string
}>()
</script>

<template>
  <section data-testid="metrics-panel">
    <h3 class="text-sm font-semibold text-text-primary">計測</h3>
    <dl class="mt-3 grid gap-2 sm:grid-cols-2">
      <div class="rounded-lg border border-border-default bg-surface p-3">
        <dt class="text-xs text-text-tertiary">初回送信までの時間</dt>
        <dd class="mt-1 text-sm font-semibold text-text-primary" data-testid="metric-first-send">{{ firstSendDurationLabel }}</dd>
      </div>
      <div class="rounded-lg border border-border-default bg-surface p-3">
        <dt class="text-xs text-text-tertiary">履歴再開成功率</dt>
        <dd class="mt-1 text-sm font-semibold text-text-primary" data-testid="metric-history-resume">
          成功 {{ historyResumeSuccessCount }} / 試行 {{ historyResumeAttemptCount }} ({{ historyResumeRateLabel }})
        </dd>
      </div>
      <div class="rounded-lg border border-border-default bg-surface p-3">
        <dt class="text-xs text-text-tertiary">承認判断時間</dt>
        <dd class="mt-1 text-sm font-semibold text-text-primary" data-testid="metric-approval-decision">
          {{ approvalDecisionCount }} 件 / 平均 {{ approvalDecisionAverageLabel }}
        </dd>
      </div>
      <div class="rounded-lg border border-border-default bg-surface p-3">
        <dt class="text-xs text-text-tertiary">モデル選択率（turn/start）</dt>
        <dd class="mt-1 text-sm font-semibold text-text-primary" data-testid="metric-model-selection">
          model 指定 {{ turnStartWithModelCount }} / turn/start {{ turnStartCount }} ({{ modelSelectionRateLabel }})
        </dd>
      </div>
    </dl>
  </section>
</template>
