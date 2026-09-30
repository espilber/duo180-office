import type { Lang, LangDicts } from '@genoffice/i18n'

/**
 * Fork-local shim: @genoffice/i18n now lists `vi` as a required language, but
 * this fork does not ship a Vietnamese UI. Fill the locale from the English
 * dictionary so the dictionaries stay type-complete without a separate
 * translation set.
 */
export function withVi<D extends Record<string, string>>(
  dicts: { zh: D } & { [L in Exclude<Lang, 'zh' | 'vi'>]: Record<keyof D, string> },
): LangDicts<D> {
  return { ...dicts, vi: dicts.en }
}
