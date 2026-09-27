declare module '*.md?raw' {
  const content: string
  export default content
}

import type { DesktopApi } from '../shared/desktop-api'

declare global {
  interface Window {
    readonly desktopApi: DesktopApi
  }
}

export {}
