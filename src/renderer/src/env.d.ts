import type { AutoCheckinApi } from '../../shared/types'
declare global { interface Window { api: AutoCheckinApi } }
declare module '*.png' { const src: string; export default src }
export {}
