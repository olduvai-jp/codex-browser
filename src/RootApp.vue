<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import router from '@/router'

function handleLogoutNavigation(): void {
  void router.replace('/login')
}

onMounted(() => {
  window.addEventListener('codex-browser-auth-logout', handleLogoutNavigation)
})

onBeforeUnmount(() => {
  window.removeEventListener('codex-browser-auth-logout', handleLogoutNavigation)
})
</script>

<template>
  <RouterView />
</template>
