import { describe, expect, it } from 'vitest'
import {
  USER_IMPORT_HEADERS,
  buildUserExportFilename,
  buildUserImportTemplate,
  isUserImportHeaderComplete,
} from './user-csv'

describe('user import csv utilities', () => {
  it('builds a template whose header matches the backend import contract', () => {
    const csv = buildUserImportTemplate()
    const lines = csv.split('\n')

    expect(lines[0]).toBe('identifier,password,displayName,role,email,channelType,gender,remark')
    expect(USER_IMPORT_HEADERS).toContain('identifier')
    expect(USER_IMPORT_HEADERS).toContain('password')
    expect(USER_IMPORT_HEADERS).toContain('displayName')
    expect(USER_IMPORT_HEADERS).toContain('role')
    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(csv).not.toContain(',"')
  })

  it('keeps example rows aligned with the header count', () => {
    const lines = buildUserImportTemplate().split('\n').slice(1).filter(Boolean)
    for (const line of lines) {
      expect(line.split(',').length).toBe(USER_IMPORT_HEADERS.length)
    }
  })

  it('validates the required header subset', () => {
    expect(isUserImportHeaderComplete(['identifier', 'password', 'displayName', 'role', 'email'])).toBe(true)
    expect(isUserImportHeaderComplete(['identifier', 'password'])).toBe(false)
    expect(isUserImportHeaderComplete([])).toBe(false)
  })

  it('generates a timestamped export filename', () => {
    const name = buildUserExportFilename(new Date(2026, 7, 2, 15, 30, 0))
    expect(name).toBe('users-20260802-153000.csv')
  })
})