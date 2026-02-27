import type { ApprovalMethodExplanation } from '@/types'

export function formatDurationMs(value: number): string {
  return `${Math.round(value)} ms`
}

export function formatRate(value: number): string {
  return `${value.toFixed(1)}%`
}

export function formatHistoryUpdatedAt(value?: string): string {
  if (!value) {
    return '-'
  }

  const normalized = value.trim()
  const unixTimeMatch = normalized.match(/^\d{10,16}$/)
  const unixTime = unixTimeMatch ? Number.parseInt(unixTimeMatch[0], 10) : Number.NaN
  const unixTimeMs = Number.isFinite(unixTime)
    ? unixTime >= 1_000_000_000_000
      ? unixTime
      : unixTime * 1000
    : Number.NaN
  const parsed = Number.isFinite(unixTimeMs) ? new Date(unixTimeMs) : new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function stringifyDetails(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function describeApprovalMethod(method: string): ApprovalMethodExplanation {
  if (method.includes('commandExecution')) {
    return {
      intent: 'この承認はコマンド実行のためのものです。',
      impact: '許可すると端末コマンドが実行され、ファイル変更や外部アクセスが発生する可能性があります。',
    }
  }

  if (method.includes('fileChange')) {
    return {
      intent: 'この承認はファイル変更のためのものです。',
      impact: '許可するとファイルの作成・更新・削除が行われる可能性があります。',
    }
  }

  if (method.includes('tool/requestUserInput')) {
    return {
      intent: 'この承認は追加入力の要求です。',
      impact: '許可すると追加の質問が表示され、あなたの入力内容が処理に使われます。',
    }
  }

  if (method.includes('tool/call')) {
    return {
      intent: 'この承認はツール呼び出しのためのものです。',
      impact: '許可すると外部ツールが実行され、データ取得や副作用が発生する可能性があります。',
    }
  }

  if (method.includes('tool/')) {
    return {
      intent: 'この承認はツール操作のためのものです。',
      impact: '許可するとツール処理が実行され、操作結果が会話に反映されます。',
    }
  }

  return {
    intent: 'この承認は処理の続行可否を確認するためのものです。',
    impact: '許可すると要求された処理が続行されます。拒否またはキャンセルすると中断されます。',
  }
}
