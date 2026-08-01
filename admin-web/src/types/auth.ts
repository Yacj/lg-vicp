export const B_ADMIN_CLIENT = 'B_ADMIN' as const

export type AuthClient = typeof B_ADMIN_CLIENT | 'C_APP' | 'PC_AI'
export type FixedUserRole = 'CHANNEL_USER' | 'NORMAL_USER' | 'SUPER_ADMIN'
export type ChannelType = 'DEALER' | 'SALESPERSON'

export interface AuthPrincipal {
  id: string
  displayName: string
  role: FixedUserRole
  channelType: ChannelType | null
  clientType: AuthClient
}

export interface CaptchaChallenge {
  captchaEnabled: boolean
  uuid: string
  image: string
  img: string
  expiresIn: number
}

export interface LoginCredentials {
  identifier: string
  password: string
  captchaUuid: string
  captchaCode: string
}

export interface AuthTokenPair {
  accessToken: string
  refreshToken: string
  refreshTokenExpiresAt: string
  clientType?: AuthClient
}

export interface LoginResult extends AuthTokenPair {
  refreshTokenId: string
  user: AuthPrincipal
}

export interface RefreshTokenResult extends AuthTokenPair {
  clientType: AuthClient
}

export interface StoredAuthSession extends AuthTokenPair {
  clientType: typeof B_ADMIN_CLIENT
}
