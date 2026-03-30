import { createRouter, createWebHistory } from 'vue-router'
import App from '@/App.vue'
import LoginView from '@/views/LoginView.vue'
import { readBrowserAuthSession } from '@/lib/browserAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: App,
    },
    {
      path: '/login',
      component: LoginView,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach(async (to) => {
  const session = await readBrowserAuthSession({
    force: true,
    onError: 'assume-auth-required',
  })

  if (!session.authEnabled) {
    if (to.path === '/login') {
      return { path: '/' }
    }
    return true
  }

  if (to.path === '/login') {
    return session.authenticated ? { path: '/' } : true
  }

  if (!session.authenticated) {
    return { path: '/login' }
  }

  return true
})

export default router
