// Import the core alova instance
import alovaInstance from './core/instance'

// Export the global Apis object from the generated code
import { createApis, withConfigType } from './createApis'

import { aiApi } from './modules/ai'
import { authApi } from './modules/auth'
import { fileApi } from './modules/files'
import { projectApi } from './modules/projects'
import { reportApi } from './modules/reports'
import { shareApi } from './modules/shares'

// Export the alova instance for direct use if needed
export { alovaInstance }
export { aiApi, authApi, fileApi, projectApi, reportApi, shareApi }

// Configure method options for specific APIs
export const $$userConfigMap = withConfigType({})

// Create the global Apis object
const Apis = createApis(alovaInstance, $$userConfigMap)

// Export both default and named export for AutoImport
export default Apis
export { Apis }
