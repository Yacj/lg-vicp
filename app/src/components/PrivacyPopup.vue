<script lang="ts" setup>
import { onBeforeMount, ref } from 'vue'

interface Props {
  title?: string // 标题
  desc?: string // 描述
  subDesc?: string // 字描述
  protocol?: string // 协议名称
}

withDefaults(defineProps<Props>(), {
  title: '用户隐私保护提示',
  desc: '感谢您使用本应用，您使用本应用的服务之前请仔细阅读并同意',
  subDesc: '。当您点击同意并开始时用产品服务时，即表示你已理解并同意该条款内容，该条款将对您产生法律约束力。如您拒绝，将无法使用相应服务。',
  protocol: '《用户隐私保护指引》',
})

const emit = defineEmits(['agree', 'disagree'])
// 默认不显示，挂载后按“是否需要授权”决定；避免每个页面重新挂载时都弹出
const showPopup = ref<boolean>(false)

const privacyResolves = ref(new Set()) // onNeedPrivacyAuthorization的reslove

// App 端本地记录同意状态；微信端由微信侧记录，不使用该标记
const PRIVACY_AGREED_KEY = 'privacy-agreed'

function privacyHandler(resolve: any) {
  showPopup.value = true
  privacyResolves.value.add(resolve)
}

onBeforeMount(() => {
  // #ifdef MP-WEIXIN
  // 仅在微信提示“需要授权”时弹出；用户同意过则 needAuthorization 为 false
  wx.getPrivacySetting?.({
    success: (res: any) => {
      if (res.needAuthorization) {
        showPopup.value = true
      }
    },
  })
  // 注册监听：调用受隐私保护接口时按需弹出
  if (wx.onNeedPrivacyAuthorization) {
    wx.onNeedPrivacyAuthorization((resolve: any) => {
      privacyHandler(resolve)
    })
  }
  // #endif

  // #ifdef APP-PLUS
  if (!uni.getStorageSync(PRIVACY_AGREED_KEY)) {
    showPopup.value = true
  }
  // #endif
})

/**
 * 同意隐私协议
 */
function handleAgree() {
  showPopup.value = false
  // #ifdef APP-PLUS
  uni.setStorageSync(PRIVACY_AGREED_KEY, true)
  // #endif
  privacyResolves.value.forEach((resolve: any) => {
    resolve({
      event: 'agree',
      buttonId: 'agree-btn',
    })
  })
  privacyResolves.value.clear()
  emit('agree')
}

/**
 * 拒绝隐私协议
 */
function handleDisagree() {
  showPopup.value = false
  privacyResolves.value.forEach((resolve: any) => {
    resolve({
      event: 'disagree',
    })
  })
  privacyResolves.value.clear()
}

/**
 * 打开隐私协议
 */
function openPrivacyContract() {
  // #ifdef MP-WEIXIN
  wx.openPrivacyContract({})
  // #endif
}

/**
 * 弹出框关闭时清空
 */
function handleClose() {
  privacyResolves.value.clear()
}
</script>

<script lang="ts">
export default {
  options: {
    virtualHost: true,
    addGlobalClass: true,
    styleIsolation: 'shared',
  },
}
</script>

<template>
  <view>
    <wd-popup v-model="showPopup" :close-on-click-modal="false" custom-class="wd-privacy-popup" @close="handleClose">
      <view class="wd-privacy-popup__header">
        <!-- 标题 -->
        <view class="wd-picker__title">
          {{ title }}
        </view>
      </view>
      <view class="wd-privacy-popup__container">
        <text>{{ desc }}</text>
        <text class="wd-privacy-popup__container-protocol" @click="openPrivacyContract">
          {{ protocol }}
        </text>
        <text>{{ subDesc }}</text>
      </view>
      <view class="wd-privacy-popup__footer">
        <wd-button
          button-id="disagree-btn"
          variant="plain"
          size="medium"
          round
          custom-class="wd-privacy-popup__footer-disagree"
          @click="handleDisagree"
        >
          拒绝
        </wd-button>
        <!-- #ifdef MP-WEIXIN -->
        <wd-button
          button-id="agree-btn"
          type="primary"
          size="medium"
          round
          custom-class="wd-privacy-popup__footer-agree"
          open-type="agreePrivacyAuthorization"
          @agreeprivacyauthorization="handleAgree"
        >
          同意
        </wd-button>
        <!-- #endif -->
        <!-- #ifndef MP-WEIXIN -->
        <wd-button
          button-id="agree-btn"
          type="primary"
          size="medium"
          round
          custom-class="wd-privacy-popup__footer-agree"
          @click="handleAgree"
        >
          同意
        </wd-button>
        <!-- #endif -->
      </view>
    </wd-popup>
  </view>
</template>

<style lang="scss" scoped>
:deep(.wd-privacy-popup) {
  width: 600rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  border-radius: 32rpx;
  overflow: hidden;
}

.wd-privacy-popup {
  &__header {
    width: 100%;
    height: 128rpx;
    line-height: 128rpx;
    color: var(--app-text-primary);
    font-size: 30rpx;
    padding: 0 12rpx;
    box-sizing: border-box;
  }

  &__container {
    width: 100%;
    box-sizing: border-box;
    padding: 0 12rpx;
    margin-bottom: 32rpx;

    font-size: 28rpx;
    line-height: 1.8;
    color: var(--app-text-secondary);
    text-align: left;
    font-weight: 550;
    &-protocol {
      color: var(--app-action-primary);
    }
  }

  &__footer {
    display: flex;
    gap: 12rpx;
    padding-bottom: 36rpx;

    &-disagree,
    &-agree {
      flex: 1;
    }
  }
}
</style>
