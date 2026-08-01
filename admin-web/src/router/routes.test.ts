import type { RouteRecordRaw } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { staticRoutes } from './routes'

function flatten(routes: RouteRecordRaw[]): RouteRecordRaw[] {
  return routes.flatMap(route => [route, ...flatten(route.children || [])])
}

describe('static route boundaries', () => {
  const routes = flatten(staticRoutes)

  it('contains the admin shell and public route names', () => {
    const names = routes
      .map(route => route.name)
      .filter((name): name is string => typeof name === 'string')

    expect(names).toEqual(['AdminRoot', 'Home', 'Login', 'Forbidden', 'NotFound'])
  })

  it('marks login and error pages outside tabs', () => {
    for (const name of ['Login', 'Forbidden', 'NotFound']) {
      expect(routes.find(route => route.name === name)?.meta?.noTab).toBe(true)
    }
  })

  it('keeps home as the only cached fixed page', () => {
    const home = routes.find(route => route.name === 'Home')
    expect(home?.meta).toMatchObject({ affix: true, keepAlive: true })
  })
})
