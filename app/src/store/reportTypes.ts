import type { ApiEnvelope, PublicReportType } from '@/api/types'
import { defineStore } from 'pinia'
import { reportApi } from '@/api/modules/reports'
import { getReportTypeCatalog, setReportTypeCatalog } from '@/constants/reports'

interface ReportTypeState {
  items: PublicReportType[]
  loaded: boolean
  loading: boolean
}

export const useReportTypeStore = defineStore('reportTypes', {
  state: (): ReportTypeState => ({
    items: getReportTypeCatalog(),
    loaded: getReportTypeCatalog().length > 0,
    loading: false,
  }),

  getters: {
    enabledItems: state => state.items.filter(item => item.enabled !== false),
  },

  actions: {
    async ensureLoaded(force = false) {
      if ((this.loaded && !force) || this.loading) {
        return this.items
      }
      this.loading = true
      try {
        const response = await reportApi.listTypes().send() as ApiEnvelope<{ items: PublicReportType[] }>
        const items = (response.data?.items || []).filter(item => item.enabled !== false)
        this.items = items
        this.loaded = true
        setReportTypeCatalog(items)
        return items
      }
      catch {
        this.loaded = this.items.length > 0
        return this.items
      }
      finally {
        this.loading = false
      }
    },
  },
})
