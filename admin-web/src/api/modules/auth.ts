import type {
  CaptchaChallenge,
  LoginCredentials,
  LoginResult,
  RefreshTokenResult,
} from '@/types/auth'
import type { CurrentUserInfo } from '@/types/user'
import { api } from '@/api/http/client'

const AUTH_BASE_URL = '/api/v1/auth'

export function fetchCaptcha(): Promise<CaptchaChallenge> {
  return api.get<CaptchaChallenge>(`${AUTH_BASE_URL}/b/captchaImage`, {
    skipAuth: true,
    skipAuthRefresh: true,
  })
}

export function loginBAdmin(credentials: LoginCredentials): Promise<LoginResult> {
  return api.post<LoginResult>(`${AUTH_BASE_URL}/b/login`, credentials, {
    skipAuth: true,
    skipAuthRefresh: true,
  })
}

export function fetchCurrentUserInfo(): Promise<CurrentUserInfo> {
  return api.get<CurrentUserInfo>(`${AUTH_BASE_URL}/b/getInfo`)
}

export function refreshAccessToken(refreshToken: string): Promise<RefreshTokenResult> {
  return api.post<RefreshTokenResult>(`${AUTH_BASE_URL}/refresh`, { refreshToken }, {
    skipAuth: true,
    skipAuthRefresh: true,
  })
}

export function logoutBAdmin(refreshToken: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(`${AUTH_BASE_URL}/logout`, { refreshToken }, {
    skipAuthRefresh: true,
  })
}
