<template>
  <div class="login-layout">
    <RouterView />
  </div>
</template>

<style scoped>
.login-layout {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: auto;
  place-items: center;
  padding: var(--td-size-8);
  background: var(--vicp-login-background);
}

.login-layout :deep(.login-page) {
  position: relative;
}

@media (max-width: 700px) {
  .login-layout {
    display: block;
    padding: 0;
  }
}
</style>
