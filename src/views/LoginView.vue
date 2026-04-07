<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import router from '@/router'
import { loginBrowserAuth, readBrowserAuthSession } from '@/lib/browserAuth'

const password = ref('')
const submitInProgress = ref(false)
const loginSuccess = ref(false)
const errorMessage = ref('')
const passwordInputRef = ref<HTMLInputElement | null>(null)

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

  const nextPassword = password.value.trim()
  if (nextPassword.length === 0) {
    errorMessage.value = 'パスワードを入力してください。'
    return
  }

  submitInProgress.value = true
  errorMessage.value = ''
  try {
    const loginResult = await loginBrowserAuth(nextPassword)
    if (!loginResult.ok) {
      errorMessage.value = loginResult.error ?? 'ログインに失敗しました。'
      return
    }

    loginSuccess.value = true
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
  nextTick(() => {
    passwordInputRef.value?.focus()
  })
})
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-surface-secondary px-4 py-12 text-text-primary">
    <section class="login-card w-full max-w-md rounded-2xl border border-border-default bg-surface p-8 shadow-xl">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
          </svg>
        </div>
        <div>
          <h1 class="text-lg font-semibold">ログイン</h1>
          <p class="text-sm text-text-muted">起動したターミナルに表示されたパスワードを入力してください。</p>
        </div>
      </div>

      <form class="mt-6 space-y-5" data-testid="auth-login-form" @submit.prevent="handleSubmit">
        <label class="block space-y-1.5">
          <span class="text-sm font-medium text-text-secondary">パスワード</span>
          <input
            ref="passwordInputRef"
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="パスワードを入力"
            class="w-full rounded-lg border border-border-default bg-surface-secondary px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
            data-testid="auth-login-password"
          >
        </label>

        <div
          v-if="errorMessage"
          class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
          data-testid="auth-login-error"
        >
          <div class="flex items-start gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
            </svg>
            <p class="leading-relaxed">{{ errorMessage }}</p>
          </div>
        </div>

        <button
          type="submit"
          class="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          :class="loginSuccess ? 'bg-success hover:bg-success/90' : 'bg-accent hover:bg-accent-hover'"
          :disabled="submitInProgress"
          data-testid="auth-login-submit"
        >
          <template v-if="submitInProgress">
            <svg class="login-spinner h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            ログイン中...
          </template>
          <template v-else-if="loginSuccess">
            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
            ログイン成功
          </template>
          <template v-else>
            ログイン
          </template>
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.login-card {
  animation: login-card-enter 0.4s ease-out;
}
@keyframes login-card-enter {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.login-spinner {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
