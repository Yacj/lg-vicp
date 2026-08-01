<script setup lang="ts">
import type { FormRules, SubmitContext } from 'tdesign-vue-next'
import type { CaptchaChallenge } from '@/types/auth'
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchCaptcha } from '@/api/modules/auth'
import AppLogo from '@/components/ui/AppLogo.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useAuthStore } from '@/stores/auth'
import { useRouteStore } from '@/stores/route'
import { useUserStore } from '@/stores/user'

defineOptions({ name: 'BAdminLogin' })

interface LoginFormData {
  identifier: string
  password: string
  captchaCode: string
}

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const routeStore = useRouteStore()
const userStore = useUserStore()
const feedback = useAppFeedback()

const formData = reactive<LoginFormData>({
  identifier: '',
  password: '',
  captchaCode: '',
})
const rules: FormRules<LoginFormData> = {
  identifier: [{ required: true, message: '请输入用户名或手机号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  captchaCode: [
    { required: true, message: '请输入验证码', trigger: 'blur' },
    { min: 4, max: 8, message: '验证码为 4 至 8 个字符', trigger: 'blur' },
  ],
}

const captcha = ref<CaptchaChallenge | null>(null)
const captchaLoading = ref(false)
const captchaError = ref('')
const submitting = ref(false)

function resolveRedirect(): string {
  const redirect = route.query.redirect
  return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
    ? redirect
    : '/'
}

async function loadCaptcha(): Promise<void> {
  captchaLoading.value = true
  captchaError.value = ''
  captcha.value = null
  formData.captchaCode = ''

  try {
    captcha.value = await fetchCaptcha()
  }
  catch (error) {
    captchaError.value = normalizeFeedbackError(error).message
  }
  finally {
    captchaLoading.value = false
  }
}

async function handleSubmit(context: SubmitContext): Promise<void> {
  if (context.validateResult !== true || !captcha.value || submitting.value) {
    if (!captcha.value && !captchaLoading.value) {
      await loadCaptcha()
    }
    return
  }

  submitting.value = true
  try {
    await authStore.login({
      identifier: formData.identifier,
      password: formData.password,
      captchaCode: formData.captchaCode,
      captchaUuid: captcha.value.uuid,
    })
    await userStore.loadUserInfo()
    await routeStore.initialize(router)
    await feedback.message('success', '登录成功')
    await router.replace(resolveRedirect())
  }
  catch (error) {
    authStore.clearSession()
    userStore.reset()
    routeStore.reset(router)
    formData.captchaCode = ''
    await feedback.messageError(error)
    await loadCaptcha()
  }
  finally {
    submitting.value = false
  }
}

onMounted(loadCaptcha)
</script>

<template>
  <main class="login-page">
    <section class="login-page__brand-panel" aria-label="产品介绍">
      <AppLogo class="login-page__logo" inverse />

      <div class="login-page__brand-copy">
        <t-tag theme="primary" variant="light">
          建筑科技 · AI 智配
        </t-tag>
        <h1>让建筑节能决策<br>更清晰、更可靠</h1>
        <p>连接项目、知识与智能分析，把节能方案从经验判断推进为可计算、可协同、可追溯的工程决策。</p>
      </div>

      <div class="login-page__signals">
        <div class="login-page__signal">
          <strong>01</strong>
          <span>项目模型与数据统一归集</span>
        </div>
        <div class="login-page__signal">
          <strong>02</strong>
          <span>节能方案计算全程留痕</span>
        </div>
        <div class="login-page__signal">
          <strong>03</strong>
          <span>AI 辅助分析协同决策</span>
        </div>
      </div>

      <div class="login-page__blueprint" aria-hidden="true">
        <span class="login-page__blueprint-axis login-page__blueprint-axis--vertical" />
        <span class="login-page__blueprint-axis login-page__blueprint-axis--horizontal" />
        <span class="login-page__blueprint-building" />
        <span class="login-page__blueprint-tower" />
        <span class="login-page__blueprint-node" />
      </div>
    </section>

    <section class="login-page__form-panel" aria-labelledby="login-title">
      <div class="login-page__form-wrap">
        <div class="login-page__mobile-logo">
          <AppLogo />
        </div>

        <header class="login-page__heading">
          <p>蓝格 VICP 建筑节能 AI 智配系统</p>
          <h2 id="login-title">
            欢迎登录
          </h2>
        </header>

        <t-form :data="formData" label-align="top" :rules="rules" @submit="handleSubmit">
          <t-form-item label="账号" name="identifier">
            <t-input
              v-model="formData.identifier"
              autocomplete="username"
              class="login-page__input"
              placeholder="请输入用户名或手机号"
            />
          </t-form-item>

          <t-form-item label="密码" name="password">
            <t-input
              v-model="formData.password"
              autocomplete="current-password"
              class="login-page__input"
              placeholder="请输入密码"
              type="password"
            />
          </t-form-item>

          <t-form-item label="验证码" name="captchaCode">
            <div class="login-page__captcha">
              <t-input
                v-model="formData.captchaCode"
                autocomplete="off"
                class="login-page__input"
                maxlength="8"
                placeholder="请输入验证码"
              />
              <t-button
                :aria-label="captcha ? '刷新验证码' : '获取验证码'"
                class="login-page__captcha-trigger"
                :disabled="submitting"
                :loading="captchaLoading"
                type="button"
                variant="outline"
                @click="loadCaptcha"
              >
                <t-image
                  v-if="captcha"
                  alt="登录验证码"
                  class="login-page__captcha-image"
                  fit="contain"
                  :src="captcha.image || captcha.img"
                />
                <span v-else-if="!captchaLoading">获取验证码</span>
              </t-button>
            </div>
          </t-form-item>

          <t-alert
            v-if="captchaError"
            class="login-page__captcha-error"
            :message="captchaError"
            theme="error"
          >
            <template #operation>
              <t-button size="small" type="button" variant="text" @click="loadCaptcha">
                重试
              </t-button>
            </template>
          </t-alert>

          <t-form-item class="login-page__submit-item">
            <t-button
              block
              :disabled="!captcha || captchaLoading"
              :loading="submitting"
              size="large"
              theme="primary"
              type="submit"
            >
              登录
            </t-button>
          </t-form-item>
        </t-form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  width: min(1180px, 100%);
  min-height: clamp(620px, calc(100dvh - 64px), 760px);
  overflow: hidden;
  grid-template-columns: minmax(0, 1.08fr) minmax(400px, 0.92fr);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-large);
  background: var(--td-bg-color-container);
  box-shadow: var(--td-shadow-2);
}

.login-page__brand-panel {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  padding: var(--td-size-13);
  color: var(--td-text-color-anti);
  background: var(--vicp-brand-panel-background);
}

.login-page__logo,
.login-page__brand-copy,
.login-page__signals {
  position: relative;
  z-index: 1;
}

.login-page__brand-copy {
  max-width: 480px;
}

.login-page__brand-copy h1 {
  margin: var(--td-size-8) 0 var(--td-size-6);
  font-size: clamp(34px, 4vw, 52px);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.16;
}

.login-page__brand-copy p {
  max-width: 430px;
  margin: 0;
  color: var(--td-font-white-2);
  font: var(--td-font-body-large);
  line-height: 1.8;
}

.login-page__signals {
  display: grid;
  gap: var(--td-size-7);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.login-page__signal {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
  padding-top: var(--td-size-5);
  border-top: 1px solid var(--td-font-white-4);
}

.login-page__signal strong {
  color: var(--td-font-white-1);
  font: var(--td-font-title-large);
}

.login-page__signal span {
  color: var(--td-font-white-2);
  font: var(--td-font-body-small);
}

.login-page__blueprint {
  position: absolute;
  inset: 0;
  opacity: 0.22;
  transform: translate(12%, 4%) rotate(-7deg);
}

.login-page__blueprint-axis,
.login-page__blueprint-building,
.login-page__blueprint-tower,
.login-page__blueprint-node {
  position: absolute;
  display: block;
}

.login-page__blueprint-axis {
  background: var(--td-font-white-3);
}

.login-page__blueprint-axis--vertical {
  top: -10%;
  right: 26%;
  width: 1px;
  height: 120%;
}

.login-page__blueprint-axis--horizontal {
  top: 46%;
  right: -10%;
  width: 120%;
  height: 1px;
}

.login-page__blueprint-building {
  right: 13%;
  bottom: 13%;
  width: 42%;
  height: 56%;
  border: 1px solid var(--td-font-white-3);
}

.login-page__blueprint-building::before,
.login-page__blueprint-building::after {
  position: absolute;
  content: '';
  background: var(--td-font-white-3);
}

.login-page__blueprint-building::before {
  top: 28%;
  left: 0;
  width: 100%;
  height: 1px;
  box-shadow: 0 76px 0 var(--td-font-white-3), 0 152px 0 var(--td-font-white-3);
}

.login-page__blueprint-building::after {
  top: 0;
  left: 33%;
  width: 1px;
  height: 100%;
  box-shadow: 76px 0 0 var(--td-font-white-3);
}

.login-page__blueprint-tower {
  top: 18%;
  right: 7%;
  width: 24%;
  height: 48%;
  border: 1px solid var(--td-font-white-3);
}

.login-page__blueprint-node {
  top: 44%;
  right: 24%;
  width: var(--td-size-5);
  height: var(--td-size-5);
  border-radius: var(--td-radius-circle);
  background: var(--td-brand-color-4);
}

.login-page__form-panel {
  display: flex;
  align-items: center;
  padding: var(--td-size-14) var(--td-size-15);
  background: var(--td-bg-color-container);
}

.login-page__form-wrap {
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
}

.login-page__mobile-logo {
  display: none;
}

.login-page__heading {
  margin-bottom: var(--td-size-9);
}

.login-page__heading p,
.login-page__heading span,
.login-page__security-note {
  color: var(--td-text-color-secondary);
}

.login-page__heading p {
  margin: 0;
  color: var(--td-text-color-brand);
  font: var(--td-font-mark-small);
}

.login-page__heading h2 {
  margin: var(--td-size-4) 0 var(--td-size-2);
  color: var(--td-text-color-primary);
  font: var(--td-font-headline-medium);
}

.login-page__heading span {
  font: var(--td-font-body-medium);
}

.login-page__input :deep(.t-input) {
  height: var(--td-comp-size-xl);
}

.login-page__captcha {
  display: grid;
  width: 100%;
  align-items: stretch;
  gap: var(--td-size-4);
  grid-template-columns: minmax(0, 1fr) 132px;
}

.login-page__captcha-trigger {
  width: 132px;
  height: var(--td-comp-size-xl);
  overflow: hidden;
  padding: 0;
  background: var(--td-bg-color-container);
}

.login-page__captcha-image {
  width: 130px;
  height: calc(var(--td-comp-size-xl) - 2px);
}

.login-page__captcha-error {
  margin-bottom: var(--td-size-6);
}

.login-page__submit-item {
  margin-top: var(--td-size-8);
  margin-bottom: 0;
}

.login-page__security-note {
  margin: var(--td-size-6) 0 0;
  font: var(--td-font-body-small);
  text-align: center;
}

@media (max-width: 960px) {
  .login-page {
    grid-template-columns: minmax(0, 1fr) minmax(380px, 0.95fr);
  }

  .login-page__brand-panel {
    padding: var(--td-size-10);
  }

  .login-page__form-panel {
    padding: var(--td-size-12) var(--td-size-10);
  }

  .login-page__signals {
    gap: var(--td-size-5);
  }
}

@media (max-width: 700px) {
  .login-page {
    display: block;
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
    overflow: visible;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .login-page__brand-panel {
    display: none;
  }

  .login-page__form-panel {
    min-height: 100vh;
    min-height: 100dvh;
    align-items: flex-start;
    padding: var(--td-size-9) var(--td-size-8);
  }

  .login-page__mobile-logo {
    display: block;
    margin-bottom: var(--td-size-14);
  }

  .login-page__heading {
    margin-bottom: var(--td-size-8);
  }
}

@media (max-width: 420px) {
  .login-page__form-panel {
    padding-inline: var(--td-size-6);
  }

  .login-page__captcha {
    grid-template-columns: minmax(0, 1fr) 116px;
  }

  .login-page__captcha-trigger {
    width: 116px;
  }

  .login-page__captcha-image {
    width: 114px;
  }
}
</style>
