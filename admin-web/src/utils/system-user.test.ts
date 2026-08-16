import { describe, expect, it } from 'vitest'
import {
  channelTypeLabels,
  isChannelUserRole,
  isNormalUserRole,
  userGenderLabels,
  userRoleLabels,
  userRoleOptionsFor,
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

  it('keeps normal user semantics bound to the normal user role only', () => {
    expect(isNormalUserRole('NORMAL_USER')).toBe(true)
    expect(isNormalUserRole('CHANNEL_USER')).toBe(false)
    expect(isNormalUserRole('SUPER_ADMIN')).toBe(false)
  })

  it('hides SUPER_ADMIN from role options for non-super-admin actors', () => {
    expect(userRoleOptionsFor('SUPER_ADMIN').map((option) => option.value)).toEqual([
      'SUPER_ADMIN',
      'CHANNEL_USER',
      'NORMAL_USER',
    ])
    expect(userRoleOptionsFor('CHANNEL_USER').map((option) => option.value)).toEqual([
      'CHANNEL_USER',
      'NORMAL_USER',
    ])
    expect(userRoleOptionsFor('NORMAL_USER').map((option) => option.value)).toEqual([
      'CHANNEL_USER',
      'NORMAL_USER',
    ])
  })
})