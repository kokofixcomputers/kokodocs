export type SettingsSection = 'account' | 'security' | 'notifications' | 'appearance' | 'assistant' | 'voice' | 'storage' | 'device' | 'snippets' | 'extended' | 'extensions'
type Listener = (s: SettingsSection | null) => void
const listeners = new Set<Listener>()
export const subscribeSettings = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l) } }
/** Open the full-page settings, optionally on a given section. */
export const openSettings = (section: SettingsSection = 'account') => listeners.forEach((l) => l(section))
export const closeSettings = () => listeners.forEach((l) => l(null))
