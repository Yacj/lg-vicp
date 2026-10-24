import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { getObservation, closeObservation } from './observation.mjs?security-v1'
const out = process.argv[2]
const base = 'http://127.0.0.1:3329/api/v1'
const credentials = JSON.parse(await readFile('C:/Users/admin/AppData/Local/Temp/vicp-final-uat-private-login.json', 'utf8'))
const result = { at: new Date().toISOString(), checks: [] }
const previous = await readFile(`${out}/security-acceptance.json`, 'utf8').catch(() => null)
if (previous) await writeFile(`${out}/security-acceptance-before-${Date.now()}.json`, previous)
async function request(route, token, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { http: response.status, data: await response.json() }
}
async function check(name, expected, route, token, method = 'GET', body) {
  const response = await request(route, token, method, body)
  const passed = response.data.success === expected
  result.checks.push({ name, expectedSuccess: expected, success: response.data.success, passed, http: response.http, errorCode: response.data.error?.code, errorType: response.data.error?.details?.errorCode })
  await writeFile(`${out}/security-acceptance.json`, JSON.stringify(result, null, 2))
  assert.ok(passed, name)
  return response.data
}
try {
  const owner = (await request('/auth/client/login/password', null, 'POST', { ...credentials, clientType: 'C_APP' })).data.data.accessToken
  const pc = (await request('/auth/client/login/password', null, 'POST', { ...credentials, clientType: 'PC_AI' })).data.data.accessToken
  const other = (await (await fetch('http://127.0.0.1:3329/__uat/user-b')).json()).token
  const state = await getObservation()
  assert.ok(state.snapshots.length > 0 && state.reports.length > 0)
  for (const conversation of state.conversations) {
    const path = `/ai/conversations/${conversation.id}`
    await check('OWNER_CONVERSATION', true, path, owner)
    for (const [kind, token] of [['OTHER_USER', other], ['CROSS_CLIENT', pc], ['UNAUTHENTICATED', null]])
      await check(`${kind}_CONVERSATION`, false, path, token)
  }
  for (const solution of state.solutions.filter(s => s.confirmed_snapshot_id)) {
    const path = `/ai/conversations/${solution.conversation_id}/solution`
    for (const [kind, token] of [['OTHER_USER', other], ['CROSS_CLIENT', pc], ['UNAUTHENTICATED', null]]) {
      await check(`${kind}_SOLUTION`, false, path, token)
      await check(`${kind}_QUERY_CANDIDATES`, false, `${path}/candidates`, token)
      await check(`${kind}_SNAPSHOT`, false, `${path}/snapshots/${solution.confirmed_snapshot_id}`, token)
      await check(`${kind}_ACTIVATE`, false, `${path}/activate`, token, 'POST', { action: 'ADD', candidateQueryRevision: 1, candidateIds: solution.payload.finalCandidateIds })
    }
    await check('OWNER_SNAPSHOT', true, `${path}/snapshots/${solution.confirmed_snapshot_id}`, owner)
    const before = (await getObservation()).snapshotCount
    const response = await check('REPEATED_CONFIRM_IDEMPOTENT', true, `${path}/actions`, owner, 'POST', { solutionStateId: solution.id, action: 'CONFIRM', expectedVersion: 1, candidateSetRevision: solution.candidate_set_revision })
    assert.equal(response.data.snapshot.id, solution.confirmed_snapshot_id)
    assert.equal((await getObservation()).snapshotCount, before)
    await check('STALE_QUERY_REVISION', false, `${path}/activate`, owner, 'POST', { action: 'ADD', candidateQueryRevision: 9999, candidateIds: solution.payload.finalCandidateIds })
    await check('FABRICATED_CANDIDATE_ID', false, `${path}/activate`, owner, 'POST', { action: 'ADD', candidateQueryRevision: 1, candidateIds: ['not-an-authorized-candidate'] })
  }
  for (const report of state.reports) {
    await check('OWNER_REPORT', true, `/reports/${report.id}`, owner)
    if (report.status === 'READY') for (const mode of ['preview', 'download']) await check(`OWNER_PDF_${mode.toUpperCase()}`, true, `/reports/${report.id}/artifacts/PDF/${mode}-url`, owner)
    for (const [kind, token] of [['OTHER_USER', other], ['UNAUTHENTICATED', null]]) {
      await check(`${kind}_REPORT`, false, `/reports/${report.id}`, token)
      for (const mode of ['preview', 'download']) await check(`${kind}_PDF_${mode.toUpperCase()}`, false, `/reports/${report.id}/artifacts/PDF/${mode}-url`, token)
    }
  }
  const wrongConversation = state.conversations.find(c => !state.snapshots.some(s => s.conversation_id === c.id))
  assert.ok(wrongConversation)
  await check('SNAPSHOT_CONVERSATION_BINDING', false, '/reports', owner, 'POST', { reportType: 'technical_scheme', conversationId: wrongConversation.id, solutionSnapshotId: state.snapshots[0].id })
  await check('REPORT_REQUIRES_REAL_SNAPSHOT', false, '/reports', owner, 'POST', { reportType: 'technical_scheme', conversationId: wrongConversation.id, solutionSnapshotId: '00000000-0000-4000-8000-000000000001' })
  result.status = 'PASS'
  result.artifactPositiveAccess = state.reports.some(r => r.status === 'READY') ? '需另见真实H5文件请求验收' : 'NOT_RUN: 实际报告生成受外部OSS阻塞，未生成可访问产物'
  result.snapshotCountUnchanged = (await getObservation()).snapshotCount === state.snapshotCount
  assert.ok(result.snapshotCountUnchanged)
  await writeFile(`${out}/security-acceptance.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, snapshotsUnchanged: result.snapshotCountUnchanged }))
} finally { await closeObservation() }
