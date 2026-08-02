import { describe, expect, it } from 'vitest'
import {
  channelTypeLabels,
  isChannelUserRole,
  userGenderLabels,
  userRoleLabels,
  userStatusLabels,
} from './system-user'

describe('system user fixed enums', () => {
  it('covers every backend user_role enum value', () => {
    expect(Object.keys(userRoleLabels).sort()).toEqual(
      ['CHANNEL_USER', 'NORMAL_USER', 'SUPER_ADMIN'].sort(),
    )
  })

  it('covers every backend channel_type enum value', () => {
    expect(Object.keys(channelTypeLabels).sort()).toEqual(['DEALER', 'SALESPERSON'].sort())
  })

  it('covers gender and status enums', () => {
    expect(Object.keys(userGenderLabels).sort()).toEqual(['FEMALE', 'MALE', 'UNKNOWN'].sort())
    expect(Object.keys(userStatusLabels).sort()).toEqual(['ACTIVE', 'DISABLED'].sort())
  })

  it('keeps channel type semantics bound to the channel user role only', () => {
    expect(isChannelUserRole('CHANNEL_USER')).toBe(true)
    expect(isChannelUserRole('SUPER_ADMIN')).toBe(false)
    expect(isChannelUserRole('NORMAL_USER')).toBe(false)
  })
})