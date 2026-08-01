import type { StoredAuthSession } from '@/types/auth'
import { B_ADMIN_CLIENT } from '@/types/auth'

const AUTH_SESSION_KEY = 'vicp_admin_auth_session'

function isStoredAuthSession(value: unknown): value is StoredAuthSession {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const session = value as Partial<StoredAuthSession>
  return session.clientType === B_ADMIN_CLIENT
    && typeof session.accessToken === 'string'
    && session.accessToken.length > 0
    && typeof session.refreshToken === 'string'
    && session.refreshToken.length > 0
    && typeof session.refreshTokenExpiresAt === 'string'
}

export function readAuthSession(): StoredAuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY)
    if (!raw) {
      return null
    }

    const session: unknown = JSON.parse(raw)
    if (!isStoredAuthSession(session) || Date.parse(session.refreshTokenExpiresAt) <= Date.now()) {
      clearAuthSession()
      return null
    }
    return session
  }
  catch {
    clearAuthSession()
    return null
  }
}

export function writeAuthSession(session: StoredAuthSession): void {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))
}

export function clearAuthSession(): void {
  localStorage.removeItem(AUTH_SESSION_KEY)
}
