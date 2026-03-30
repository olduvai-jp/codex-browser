<script setup lang="ts">
import { onMounted, ref } from 'vue'
import router from '@/router'
import { loginBrowserAuth, readBrowserAuthSession } from '@/lib/browserAuth'

const username = ref('')
const password = ref('')
const submitInProgress = ref(false)
const errorMessage = ref('')

async function redirectIfAuthenticated(): Promise<void> {
  const session = await readBrowserAuthSession({
    force: true,
    onError: 'assume-auth-required',
  })
  if (!session.authEnabled || session.authenticated) {
    await router.replace('/')
  }
}

async function handleSubmit(): Promise<void> {
  if (submitInProgress.value) {
    return
  }

  const nextUsername = username.value.trim()
  const nextPassword = password.value.trim()
  if (nextUsername.length === 0 || nextPassword.length === 0) {
    errorMessage.value = 'ユーザー名とパスワードを入力してください。'
    return
  }

  submitInProgress.value = true
  errorMessage.value = ''
  try {
    const loginResult = await loginBrowserAuth(nextUsername, nextPassword)
    if (!loginResult.ok) {
      errorMessage.value = loginResult.error ?? 'ログインに失敗しました。'
      return
    }

    await redirectIfAuthenticated()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errorMessage.value = `ログインに失敗しました。${message}`
  } finally {
    submitInProgress.value = false
  }
}

onMounted(() => {
  void redirectIfAuthenticated()
})
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-chat-bg px-4 py-12 text-text-primary">
    <section class="w-full max-w-md rounded-2xl border border-border-default bg-surface-primary p-6 shadow-sm">
      <h1 class="text-xl font-semibold">ログイン</h1>
      <p class="mt-1 text-sm text-text-muted">設定済みのユーザー名とパスワードでログインしてください。</p>

      <form class="mt-6 space-y-4" data-testid="auth-login-form" @submit.prevent="handleSubmit">
        <label class="block space-y-1">
          <span class="text-sm text-text-secondary">ユーザー名</span>
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            class="w-full rounded-lg border border-border-default bg-chat-bg px-3 py-2 text-sm outline-none transition focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
            data-testid="auth-login-username"
          >
        </label>

        <label class="block space-y-1">
          <span class="text-sm text-text-secondary">パスワード</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="w-full rounded-lg border border-border-default bg-chat-bg px-3 py-2 text-sm outline-none transition focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
            data-testid="auth-login-password"
          >
        </label>

        <p v-if="errorMessage" class="text-sm text-danger" data-testid="auth-login-error">{{ errorMessage }}</p>

        <button
          type="submit"
          class="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="submitInProgress"
          data-testid="auth-login-submit"
        >
          {{ submitInProgress ? 'ログイン中...' : 'ログイン' }}
        </button>
      </form>
    </section>
  </main>
</template>
