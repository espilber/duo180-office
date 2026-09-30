import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BrowserWindow,
  WebContentsView,
  app,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  webContents,
} from 'electron'
import type { WebContents } from 'electron'
import {
  configuredDefaultSaveDir,
  contextMenuLabels,
  fetchRemoteImage,
  installContextMenu,
  installNavigationGuard,
  isHeadlessMode,
  safeExternalUrl,
  showOpenDialogWithMemory,
  showSaveDialogWithMemory,
  type HeadlessExportFormat,
  type HeadlessExportTarget,
  installRendererProtocol,
  rendererUrl,
  MAX_REMOTE_IMAGE_BYTES,
  readBodyCapped,
} from '@genoffice/electron-utils'
import { createI18n, getUiLang } from '@genoffice/i18n'
import { withVi } from '../shared/with-vi'
import { convertHtmlToDocx } from '../../../../packages/html2docx/src'
import { atomicWriteFile } from './atomic-write'
import { ElectronBrowserDriver } from '../../../../packages/html2docx/src/drivers/electron'
import {
  copyImageIntoOwnedAssets,
  discardPendingOwnedAssets,
  extractHtmlImageSources,
  isInDocDir,
  pendingOwnedAssetsForDocument,
  prepareAssetsForSaveAs,
  reconcileOwnedAssets,
  renameOwnedAssetDocument,
  resolveSafeRelativeImagePath,
  resolveSourcePendingAfterSaveAs,
  rollbackPreparedSaveAsAssets,
  writeImageIntoOwnedAssets,
} from './asset-lifecycle'
import {
  ASSET_SNIFF_BYTES,
  PREVIEW_ASSET_EXTS,
  editableImageMime,
  extensionlessAssetMime,
} from './asset-mime'
import { buildPreviewDocument } from './preview-document'
import { inlineImagesForSingleFile, singleFileExportBaseName } from './single-file-html'
import {
  assetBaseHref,
  previewUrlFor,
  registerPrivilegedSchemes,
  registerPreviewProtocol,
} from './preview-protocol'
import { HTML_CHANNELS } from '../shared/ipc'
import type {
  ExportDocxRequest,
  ExportHtmlRequest,
  ExportFormat,
  ExportPdfRequest,
  ExportResult,
  ImageData,
  SaveHtmlRequest,
  SaveHtmlResult,
  SaveMode,
} from '../shared/ipc'

const tDlg = createI18n(
  withVi({
    zh: {
      dlgSaveTitle: '保存 HTML 文档',
      filterHtml: 'HTML 文档',
      dlgPickImage: '选择图片',
      filterImages: '图片',
      untitledFile: '未命名文档',
      closeUnsavedMsg: '此文档有未保存的更改。',
      closeUnsavedDetail: '关闭前是否保存？',
      btnSave: '保存',
      btnDontSave: '不保存',
      btnCancel: '取消',
    },
    en: {
      dlgSaveTitle: 'Save HTML Document',
      filterHtml: 'HTML Documents',
      dlgPickImage: 'Choose an Image',
      filterImages: 'Images',
      untitledFile: 'Untitled',
      closeUnsavedMsg: 'This document has unsaved changes.',
      closeUnsavedDetail: 'Do you want to save them before closing?',
      btnSave: 'Save',
      btnDontSave: "Don't Save",
      btnCancel: 'Cancel',
    },
    ja: {
      dlgSaveTitle: 'HTML ドキュメントを保存',
      filterHtml: 'HTML ドキュメント',
      dlgPickImage: '画像を選択',
      filterImages: '画像',
      untitledFile: '無題',
      closeUnsavedMsg: 'このドキュメントに未保存の変更があります。',
      closeUnsavedDetail: '閉じる前に保存しますか？',
      btnSave: '保存',
      btnDontSave: '保存しない',
      btnCancel: 'キャンセル',
    },
    ko: {
      dlgSaveTitle: 'HTML 문서 저장',
      filterHtml: 'HTML 문서',
      dlgPickImage: '이미지 선택',
      filterImages: '이미지',
      untitledFile: '제목 없음',
      closeUnsavedMsg: '이 문서에 저장하지 않은 변경 사항이 있습니다.',
      closeUnsavedDetail: '닫기 전에 저장하시겠습니까?',
      btnSave: '저장',
      btnDontSave: '저장 안 함',
      btnCancel: '취소',
    },
    fr: {
      dlgSaveTitle: 'Enregistrer le document HTML',
      filterHtml: 'Documents HTML',
      dlgPickImage: 'Choisir une image',
      filterImages: 'Images',
      untitledFile: 'Sans titre',
      closeUnsavedMsg: 'Ce document contient des modifications non enregistrées.',
      closeUnsavedDetail: 'Voulez-vous les enregistrer avant de fermer ?',
      btnSave: 'Enregistrer',
      btnDontSave: 'Ne pas enregistrer',
      btnCancel: 'Annuler',
    },
    de: {
      dlgSaveTitle: 'HTML-Dokument speichern',
      filterHtml: 'HTML-Dokumente',
      dlgPickImage: 'Bild auswählen',
      filterImages: 'Bilder',
      untitledFile: 'Unbenannt',
      closeUnsavedMsg: 'Dieses Dokument enthält ungespeicherte Änderungen.',
      closeUnsavedDetail: 'Vor dem Schließen speichern?',
      btnSave: 'Speichern',
      btnDontSave: 'Nicht speichern',
      btnCancel: 'Abbrechen',
    },
    es: {
      dlgSaveTitle: 'Guardar documento HTML',
      filterHtml: 'Documentos HTML',
      dlgPickImage: 'Elegir imagen',
      filterImages: 'Imágenes',
      untitledFile: 'Sin título',
      closeUnsavedMsg: 'Este documento tiene cambios sin guardar.',
      closeUnsavedDetail: '¿Quieres guardarlos antes de cerrar?',
      btnSave: 'Guardar',
      btnDontSave: 'No guardar',
      btnCancel: 'Cancelar',
    },
    th: {
      dlgSaveTitle: 'บันทึกเอกสาร HTML',
      filterHtml: 'เอกสาร HTML',
      dlgPickImage: 'เลือกรูปภาพ',
      filterImages: 'รูปภาพ',
      untitledFile: 'ไม่มีชื่อ',
      closeUnsavedMsg: 'เอกสารนี้มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก',
      closeUnsavedDetail: 'ต้องการบันทึกก่อนปิดหรือไม่?',
      btnSave: 'บันทึก',
      btnDontSave: 'ไม่บันทึก',
      btnCancel: 'ยกเลิก',
    },
    id: {
      dlgSaveTitle: 'Simpan dokumen HTML',
      filterHtml: 'Dokumen HTML',
      dlgPickImage: 'Pilih gambar',
      filterImages: 'Gambar',
      untitledFile: 'Tanpa judul',
      closeUnsavedMsg: 'Dokumen ini memiliki perubahan yang belum disimpan.',
      closeUnsavedDetail: 'Simpan sebelum menutup?',
      btnSave: 'Simpan',
      btnDontSave: 'Jangan Simpan',
      btnCancel: 'Batal',
    },
    ru: {
      dlgSaveTitle: 'Сохранить документ HTML',
      filterHtml: 'Документы HTML',
      dlgPickImage: 'Выберите изображение',
      filterImages: 'Изображения',
      untitledFile: 'Без названия',
      closeUnsavedMsg: 'В этом документе есть несохранённые изменения.',
      closeUnsavedDetail: 'Сохранить их перед закрытием?',
      btnSave: 'Сохранить',
      btnDontSave: 'Не сохранять',
      btnCancel: 'Отмена',
    },
    ar: {
      dlgSaveTitle: 'حفظ مستند HTML',
      filterHtml: 'مستندات HTML',
      dlgPickImage: 'اختر صورة',
      filterImages: 'صور',
      untitledFile: 'بدون عنوان',
      closeUnsavedMsg: 'يحتوي هذا المستند على تغييرات غير محفوظة.',
      closeUnsavedDetail: 'هل تريد حفظها قبل الإغلاق؟',
      btnSave: 'حفظ',
      btnDontSave: 'عدم الحفظ',
      btnCancel: 'إلغاء',
    },
    pt: {
      dlgSaveTitle: 'Salvar documento HTML',
      filterHtml: 'Documentos HTML',
      dlgPickImage: 'Escolher imagem',
      filterImages: 'Imagens',
      untitledFile: 'Sem título',
      closeUnsavedMsg: 'Este documento tem alterações não salvas.',
      closeUnsavedDetail: 'Deseja salvá-las antes de fechar?',
      btnSave: 'Salvar',
      btnDontSave: 'Não Salvar',
      btnCancel: 'Cancelar',
    },
    it: {
      dlgSaveTitle: 'Salva documento HTML',
      filterHtml: 'Documenti HTML',
      dlgPickImage: 'Scegli immagine',
      filterImages: 'Immagini',
      untitledFile: 'Senza titolo',
      closeUnsavedMsg: 'Questo documento contiene modifiche non salvate.',
      closeUnsavedDetail: 'Vuoi salvarle prima di chiudere?',
      btnSave: 'Salva',
      btnDontSave: 'Non salvare',
      btnCancel: 'Annulla',
    },
    pl: {
      dlgSaveTitle: 'Zapisz dokument HTML',
      filterHtml: 'Dokumenty HTML',
      dlgPickImage: 'Wybierz obraz',
      filterImages: 'Obrazy',
      untitledFile: 'Bez tytułu',
      closeUnsavedMsg: 'Ten dokument ma niezapisane zmiany.',
      closeUnsavedDetail: 'Czy zapisać je przed zamknięciem?',
      btnSave: 'Zapisz',
      btnDontSave: 'Nie zapisuj',
      btnCancel: 'Anuluj',
    },
    cs: {
      dlgSaveTitle: 'Uložit dokument HTML',
      filterHtml: 'Dokumenty HTML',
      dlgPickImage: 'Vyberte obrázek',
      filterImages: 'Obrázky',
      untitledFile: 'Bez názvu',
      closeUnsavedMsg: 'Tento dokument obsahuje neuložené změny.',
      closeUnsavedDetail: 'Chcete je před zavřením uložit?',
      btnSave: 'Uložit',
      btnDontSave: 'Neukládat',
      btnCancel: 'Zrušit',
    },
    nl: {
      dlgSaveTitle: 'HTML-document opslaan',
      filterHtml: 'HTML-documenten',
      dlgPickImage: 'Kies een afbeelding',
      filterImages: 'Afbeeldingen',
      untitledFile: 'Naamloos',
      closeUnsavedMsg: 'Dit document bevat niet-opgeslagen wijzigingen.',
      closeUnsavedDetail: 'Wilt u ze opslaan voordat u sluit?',
      btnSave: 'Opslaan',
      btnDontSave: 'Niet opslaan',
      btnCancel: 'Annuleren',
    },
    ms: {
      dlgSaveTitle: 'Simpan dokumen HTML',
      filterHtml: 'Dokumen HTML',
      dlgPickImage: 'Pilih imej',
      filterImages: 'Imej',
      untitledFile: 'Tanpa tajuk',
      closeUnsavedMsg: 'Dokumen ini mempunyai perubahan yang belum disimpan.',
      closeUnsavedDetail: 'Simpan sebelum menutup?',
      btnSave: 'Simpan',
      btnDontSave: 'Jangan Simpan',
      btnCancel: 'Batal',
    },
    he: {
      dlgSaveTitle: 'שמירת מסמך HTML',
      filterHtml: 'מסמכי HTML',
      dlgPickImage: 'בחרו תמונה',
      filterImages: 'תמונות',
      untitledFile: 'ללא שם',
      closeUnsavedMsg: 'במסמך הזה יש שינויים שלא נשמרו.',
      closeUnsavedDetail: 'האם לשמור אותם לפני הסגירה?',
      btnSave: 'שמירה',
      btnDontSave: 'אל תשמור',
      btnCancel: 'ביטול',
    },
    hi: {
      dlgSaveTitle: 'HTML दस्तावेज़ सहेजें',
      filterHtml: 'HTML दस्तावेज़',
      dlgPickImage: 'छवि चुनें',
      filterImages: 'छवियाँ',
      untitledFile: 'शीर्षकहीन',
      closeUnsavedMsg: 'इस दस्तावेज़ में सहेजे नहीं गए परिवर्तन हैं।',
      closeUnsavedDetail: 'क्या बंद करने से पहले उन्हें सहेजना चाहते हैं?',
      btnSave: 'सहेजें',
      btnDontSave: 'न सहेजें',
      btnCancel: 'रद्द करें',
    },
    'zh-TW': {
      dlgSaveTitle: '儲存 HTML 文件',
      filterHtml: 'HTML 文件',
      dlgPickImage: '選擇圖片',
      filterImages: '圖片',
      untitledFile: '未命名文件',
      closeUnsavedMsg: '此文件有未儲存的變更。',
      closeUnsavedDetail: '關閉前是否儲存？',
      btnSave: '儲存',
      btnDontSave: '不儲存',
      btnCancel: '取消',
    },
  }),
)
type DlgKey =
  | 'dlgSaveTitle'
  | 'filterHtml'
  | 'dlgPickImage'
  | 'filterImages'
  | 'untitledFile'
  | 'closeUnsavedMsg'
  | 'closeUnsavedDetail'
  | 'btnSave'
  | 'btnDontSave'
  | 'btnCancel'
const tm = (key: DlgKey, vars?: Record<string, string | number>) => tDlg(getUiLang(), key, vars)

interface RuntimePaths {
  preloadPath: string
  rendererUrl?: string
  rendererFile?: string
  /** Shell router used to open exported PDFs in a new GenOffice tab. */
  openGeneratedPath?: (path: string) => boolean
}

let runtime: RuntimePaths = { preloadPath: '' }

export function configureHtmlRuntime(paths: RuntimePaths): void {
  runtime = paths
}

export { registerPrivilegedSchemes }

/** After a successful Html → PDF export: open the file in a PDF tab (shell)
 * or reveal it in the folder (standalone). Tab-opening failure must not
 * report the export itself as failed — the file is already persisted. */
function openExportedPdf(path: string): void {
  // Headless export must stay silent: no tab, no Finder window.
  if (isHeadlessMode()) return
  try {
    if (runtime.openGeneratedPath?.(path)) return
  } catch (err) {
    console.warn('[html] Failed to open exported PDF:', err)
  }
  shell.showItemInFolder(path)
}

/** Open path per view, queued at tab creation; the renderer consumes it after mount.
 * Kept until the view is destroyed so a reload (View > Reload) consumes it again. */
const openPathByWc = new Map<number, string>()
/** File paths granted to each view — readFile/save only allow these */
const allowedByWc = new Map<number, Set<string>>()
/** Current save target per view; absent = untitled document */
const savePathByWc = new Map<number, string>()
/** Unsaved-changes flags mirrored from the renderer; drives the save prompt before closing a tab/window */
const dirtyByWc = new Set<number>()
/** Latest buffer text pushed by each renderer; served by html-preview:// to the preview iframe */
const previewTextByWc = new Map<number, string>()
const closeSaveWaiters = new Map<number, (ok: boolean) => void>()
/** Resolvers for menu-triggered saves, resolved when the renderer's save invoke completes */
const saveWaiters = new Map<number, (ok: boolean) => void>()
/** Resolvers for MCP reads of the live document source, resolved by the renderer's reply */
const readTextWaiters = new Map<number, (result: { text: string } | { error: string }) => void>()
/** one read per tab at a time: concurrent callers share this promise */
const readTextInFlight = new Map<number, Promise<string>>()

/** Fired after a save lands on a NEW path (untitled first save / Save As) — the shell syncs tab title, recents, projects */
let fileSavedHook: ((wc: WebContents, path: string) => void) | null = null

export function setHtmlFileSavedHook(hook: (wc: WebContents, path: string) => void): void {
  fileSavedHook = hook
}

/** An untitled document got a provisional name from the user's first request — the shell titles its tab */
let provisionalTitleHook: ((wc: WebContents, title: string) => void) | null = null

export function setHtmlProvisionalTitleHook(hook: (wc: WebContents, title: string) => void): void {
  provisionalTitleHook = hook
}

/** After a Word export the shell opens the new .docx in a docs tab; standalone reveals it */
let docxExportedHook: ((path: string) => void) | null = null
/** Before the .docx is written: the shell closes a docs tab already showing that path
 * (its unsaved-changes prompt applies); false = the user kept it, so the export is dropped */
let docxExportPrepareHook: ((path: string) => Promise<boolean>) | null = null

export function setHtmlDocxExportedHook(hook: (path: string) => void): void {
  docxExportedHook = hook
}

export function setHtmlDocxExportPrepareHook(hook: (path: string) => Promise<boolean>): void {
  docxExportPrepareHook = hook
}

function openExportedDocx(path: string): void {
  if (isHeadlessMode()) return
  try {
    if (docxExportedHook) {
      docxExportedHook(path)
      return
    }
  } catch (err) {
    console.warn('[html] Failed to open exported Word file:', err)
  }
  shell.showItemInFolder(path)
}

function exportFileName(suggested: unknown): string {
  return (
    String(suggested || tm('untitledFile'))
      .replace(/[/\\:*?"<>|]/g, '_')
      .slice(0, 80)
      .trim() || tm('untitledFile')
  )
}

export interface HtmlPresentHooks {
  /** cover the tab strip with the presenting tab's view (shell tab mode) */
  setBleed?: (wc: WebContents, on: boolean) => void
  /** window hosting a view when BrowserWindow.fromWebContents cannot tell (shell WebContentsView) */
  hostWindow?: (wc: WebContents) => BrowserWindow | null
  /** open a chrome-free tab presenting the owner view's preview; false → a window is opened instead */
  openTab?: (owner: WebContents, title: string) => boolean
  /** close the tab hosting a present view; false → not a tab of this shell */
  closeTab?: (wc: WebContents) => boolean
}
let presentHooks: HtmlPresentHooks = {}
export function setHtmlPresentHooks(hooks: HtmlPresentHooks): void {
  presentHooks = hooks
}
/** present views → the editing view whose preview they show */
const presentOwnerByWc = new Map<number, number>()
/** standalone Present windows; unreferenced BrowserWindows may be garbage-collected */
const presentWindows = new Set<BrowserWindow>()

/** The owner view is gone, so is its preview: close every present view showing it */
function closePresentViewsOf(ownerWcId: number): void {
  for (const [id, owner] of presentOwnerByWc) {
    if (owner !== ownerWcId) continue
    presentOwnerByWc.delete(id)
    const wc = webContents.fromId(id)
    if (!wc || wc.isDestroyed()) continue
    if (presentHooks.closeTab?.(wc)) continue
    const win = BrowserWindow.fromWebContents(wc)
    if (win && !win.isDestroyed()) win.close()
    else wc.close()
  }
}

/** A4 at 96dpi; html2docx re-measures at the authored width itself when the page asks for more. */
const HTML2DOCX_VIEWPORT = { width: 794, height: 1123, deviceScaleFactor: 2 }

/** Print the document in a hidden script-free window (sheets-style). Relative assets
 * resolve through html-asset:// against the document's folder, exactly as in the preview. */
async function renderPrintPdf(
  html: string,
  docPath: string | undefined,
  workDir: string,
): Promise<Buffer> {
  const base = docPath ? assetBaseHref(dirname(docPath)) : null
  const htmlPath = join(workDir, 'print.html')
  await writeFile(htmlPath, buildPreviewDocument(html, base), 'utf8')
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false },
  })
  try {
    await printWin.loadFile(htmlPath)
    return await printWin.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    })
  } finally {
    printWin.destroy()
  }
}

/** Shell menu export entry: ask the renderer to serialize and run the export flow */
export function sendHtmlExportRequest(contents: WebContents, format: ExportFormat): void {
  if (contents.isDestroyed() || presentOwnerByWc.has(contents.id)) return
  contents.send(HTML_CHANNELS.exportRequest, format)
}

/** Shell menu Print: ask the renderer to build the print HTML and open the system dialog */
export function sendHtmlPrintRequest(contents: WebContents): void {
  if (contents.isDestroyed() || presentOwnerByWc.has(contents.id)) return
  contents.send(HTML_CHANNELS.printRequest)
}

export function htmlIsDirty(webContentsId: number): boolean {
  return dirtyByWc.has(webContentsId)
}

export function htmlFilePath(webContentsId: number): string | undefined {
  return savePathByWc.get(webContentsId)
}

/** The file was renamed on disk — re-grant the new path and tell the renderer */
export function htmlFileRenamed(contents: WebContents, oldPath: string, newPath: string): void {
  const wcId = contents.id
  if (savePathByWc.get(wcId) === oldPath) savePathByWc.set(wcId, newPath)
  if (openPathByWc.get(wcId) === oldPath) openPathByWc.set(wcId, newPath)
  const allowed = allowedByWc.get(wcId)
  if (allowed?.has(oldPath)) allowed.add(newPath)
  void renameOwnedAssetDocument(oldPath, newPath).catch((error) => {
    console.warn('[html] asset manifest rename sync failed:', error)
  })
  if (!contents.isDestroyed()) contents.send(HTML_CHANNELS.fileRenamed, newPath)
}

/**
 * Close guard: true means proceed with closing. Clean → true; dirty →
 * Save / Don't Save / Cancel. On Save, ask the renderer to serialize + write
 * and await the result; a canceled untitled-save dialog keeps the tab open.
 */
export async function requestHtmlClose(
  contents: WebContents,
  parent?: BrowserWindow | null,
): Promise<boolean> {
  if (!dirtyByWc.has(contents.id) || contents.isDestroyed()) return true
  const options = {
    type: 'warning' as const,
    message: tm('closeUnsavedMsg'),
    detail: tm('closeUnsavedDetail'),
    buttons: [tm('btnSave'), tm('btnDontSave'), tm('btnCancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const { response } =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
  if (response === 2) return false
  if (response === 1) {
    const documentPath = savePathByWc.get(contents.id)
    if (documentPath) {
      const discarded = await discardPendingOwnedAssets(documentPath)
      if (discarded.errors.length > 0) {
        console.warn('[html] pending asset discard incomplete:', discarded.errors)
      }
    }
    return true
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      closeSaveWaiters.delete(contents.id)
      resolve(false)
    }, 120_000)
    closeSaveWaiters.set(contents.id, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    contents.send(HTML_CHANNELS.closeSaveRequest)
  })
}

/**
 * Drop assets staged next to the document but never written into it — the MCP
 * "discard unsaved changes" path, same cleanup the interactive close prompt
 * runs when the user picks "Don't Save".
 */
export async function htmlDiscardPendingAssets(contents: WebContents): Promise<void> {
  const documentPath = savePathByWc.get(contents.id)
  if (!documentPath) return
  const discarded = await discardPendingOwnedAssets(documentPath)
  if (discarded.errors.length > 0) {
    console.warn('[html] pending asset discard incomplete:', discarded.errors)
  }
}

/** Menu Save / Save As: ask the renderer to serialize and save; clean views resolve true immediately on plain save */
export function requestHtmlSave(contents: WebContents, mode: SaveMode): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(false)
  if (presentOwnerByWc.has(contents.id)) return Promise.resolve(true)
  if (mode === 'save' && !dirtyByWc.has(contents.id) && savePathByWc.has(contents.id)) {
    return Promise.resolve(true)
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      saveWaiters.delete(contents.id)
      resolve(false)
    }, 120_000)
    saveWaiters.set(contents.id, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    contents.send(HTML_CHANNELS.saveRequest, mode)
  })
}

/**
 * Read the live document source for an MCP `open_documents` read. The buffer the
 * renderer pushes for the preview is instrumented for the iframe, so it cannot
 * be reused here: this asks for the saved serialization instead, unsaved edits
 * included.
 */
export function htmlReadText(contents: WebContents): Promise<string> {
  if (contents.isDestroyed()) return Promise.reject(new Error('the document is no longer open'))
  const wcId = contents.id
  const inFlight = readTextInFlight.get(wcId)
  if (inFlight) return inFlight
  const request = new Promise<string>((resolve, reject) => {
    // The renderer registers its listener while mounting, which can land after
    // the tab appears; a request sent before that is dropped silently. Re-send
    // on an interval until the renderer answers, the way the shell's own
    // control channel polls for a not-yet-ready editor.
    let settled = false
    const settle = (finish: () => void): void => {
      if (settled) return
      settled = true
      clearInterval(retry)
      clearTimeout(timer)
      readTextWaiters.delete(wcId)
      readTextInFlight.delete(wcId)
      finish()
    }
    const retry = setInterval(() => {
      if (contents.isDestroyed()) {
        settle(() => reject(new Error('the document is no longer open')))
        return
      }
      contents.send(HTML_CHANNELS.readTextRequest)
    }, 250)
    const timer = setTimeout(
      () => settle(() => reject(new Error('timed out reading the document'))),
      30_000,
    )
    readTextWaiters.set(wcId, (result) => {
      settle(() => {
        if ('text' in result) resolve(result.text)
        else reject(new Error(result.error))
      })
    })
    contents.send(HTML_CHANNELS.readTextRequest)
  })
  readTextInFlight.set(wcId, request)
  return request
}

/**
 * Save the live document to `filePath` with no dialog — the MCP close path
 * ("save before closing"). Pointing the view's save target at `filePath` first
 * keeps `resolveSaveTarget` from opening the save dialog, so the renderer's
 * normal save runs unattended.
 */
export function htmlSaveToPath(contents: WebContents, filePath: string): Promise<void> {
  if (contents.isDestroyed()) return Promise.reject(new Error('the document is no longer open'))
  const wcId = contents.id
  const previousPath = savePathByWc.get(wcId)
  const previousOpenPath = openPathByWc.get(wcId)
  savePathByWc.set(wcId, filePath)
  const allowed = allowedByWc.get(wcId) ?? new Set<string>()
  allowed.add(filePath)
  allowedByWc.set(wcId, allowed)
  return new Promise<void>((resolve, reject) => {
    const restore = (): void => {
      if (previousPath === undefined) savePathByWc.delete(wcId)
      else savePathByWc.set(wcId, previousPath)
      if (previousOpenPath === undefined) openPathByWc.delete(wcId)
      else openPathByWc.set(wcId, previousOpenPath)
    }
    const timer = setTimeout(() => {
      saveWaiters.delete(wcId)
      restore()
      reject(new Error('timed out saving the document'))
    }, 120_000)
    saveWaiters.set(wcId, (ok) => {
      clearTimeout(timer)
      if (ok) resolve()
      else {
        restore()
        reject(new Error('could not save the document'))
      }
    })
    contents.send(HTML_CHANNELS.saveRequest, 'save')
  })
}

async function writeTextAtomic(path: string, text: string): Promise<void> {
  await atomicWriteFile(path, Buffer.from(text, 'utf8'))
}

function fileNameBase(name: string | undefined): string {
  return (name ?? '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .slice(0, 80)
    .trim()
}

async function resolveSaveTarget(
  e: Electron.IpcMainInvokeEvent,
  mode: SaveMode,
  suggestedName?: string,
): Promise<string | null | 'canceled'> {
  const current = savePathByWc.get(e.sender.id)
  if (mode === 'save' && current) return current
  // silent first save of an untitled document under a generated name
  if (mode === 'save' && !current && suggestedName) {
    const base = fileNameBase(suggestedName)
    if (base) {
      const dir = configuredDefaultSaveDir(app)
      let target = join(dir, `${base}.html`)
      for (let n = 1; existsSync(target); n++) target = join(dir, `${base}-${n}.html`)
      return target
    }
  }
  const win =
    BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
  const defaultPath = current
    ? join(dirname(current), basename(current))
    : join(configuredDefaultSaveDir(app), `${tm('untitledFile')}.html`)
  const picked = await showSaveDialogWithMemory(dialog, win, {
    title: tm('dlgSaveTitle'),
    defaultPath,
    filters: [{ name: tm('filterHtml'), extensions: ['html', 'htm'] }],
  })
  if (picked.canceled || !picked.filePath) return 'canceled'
  return picked.filePath
}

/**
 * Serves authored image paths to the editor DOM. A plain file:// <img> URL is
 * blocked whenever the renderer page is served over http (dev server), so the
 * renderer resolves images to html-asset:// instead. Only files inside an open
 * document's directory are served: by extension, or for extensionless
 * "Save page as, complete" assets by signature / requesting slot.
 */
function registerImageProtocol(): void {
  protocol.handle('html-asset', async (request) => {
    let target: string
    try {
      target = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response(null, { status: 400 })
    }
    if (/^\/[a-zA-Z]:\//.test(target)) target = target.slice(1)
    target = resolve(target)
    const knownExt = PREVIEW_ASSET_EXTS.has(extname(target).toLowerCase())
    if (!existsSync(target)) return new Response(null, { status: 404 })
    let inDocDir = false
    for (const doc of new Set([...openPathByWc.values(), ...savePathByWc.values()])) {
      const dir = resolve(dirname(doc))
      if (!isInDocDir(target, dir)) continue
      if (await resolveSafeRelativeImagePath(doc, relative(dir, target))) {
        inDocDir = true
        break
      }
    }
    if (!inDocDir) return new Response(null, { status: 403 })
    let mime: string | null = null
    if (!knownExt) {
      mime = extensionlessAssetMime(target, await readHead(target), request.headers.get('accept'))
      if (!mime) return new Response(null, { status: 404 })
    }
    const res = await net.fetch(pathToFileURL(target).toString())
    if (!mime || !res.ok) return res
    return new Response(res.body, { status: 200, headers: { 'Content-Type': mime } })
  })
}

async function readHead(target: string): Promise<Uint8Array> {
  const handle = await open(target, 'r')
  try {
    const buffer = Buffer.alloc(ASSET_SNIFF_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, ASSET_SNIFF_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

let ipcRegistered = false

function registerHtmlIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  registerImageProtocol()
  registerPreviewProtocol((wcId) => {
    const text = previewTextByWc.get(wcId)
    if (text === undefined) return null
    const doc = savePathByWc.get(wcId)
    return { text, baseHref: doc ? assetBaseHref(dirname(doc)) : null }
  })

  ipcMain.handle(HTML_CHANNELS.consumePending, (e) => openPathByWc.get(e.sender.id) ?? null)

  // ---- headless export mode (--headless-export) ----

  ipcMain.handle(HTML_CHANNELS.consumeHeadlessExport, (e): HeadlessExportTarget | null => {
    const target = headlessExportTargets.get(e.sender.id) ?? null
    headlessExportTargets.delete(e.sender.id)
    return target
  })

  ipcMain.on(HTML_CHANNELS.headlessExportDone, (e, result: unknown) => {
    const settle = headlessExportWaiters.get(e.sender.id)
    if (!settle) return
    headlessExportWaiters.delete(e.sender.id)
    const state = result as { ok?: unknown; error?: unknown } | null
    settle({
      ok: state?.ok === true,
      ...(typeof state?.error === 'string' ? { error: state.error } : {}),
    })
  })

  ipcMain.on(HTML_CHANNELS.previewUpdate, (e, text: unknown) => {
    if (typeof text === 'string') previewTextByWc.set(e.sender.id, text)
  })

  ipcMain.handle(HTML_CHANNELS.previewInfo, (e) => ({
    url: previewUrlFor(presentOwnerByWc.get(e.sender.id) ?? e.sender.id),
  }))

  // Same shape as the slides show: the renderer asks for the screen in one call so the
  // macOS snap skips the Space animation; HTML fullscreen is left to the renderer elsewhere.
  let presentFsRelease: ReturnType<typeof setTimeout> | null = null
  ipcMain.handle(HTML_CHANNELS.presentFullScreen, (e, on: unknown) => {
    const wc = e.sender
    const win = BrowserWindow.fromWebContents(wc) ?? presentHooks.hostWindow?.(wc) ?? null
    if (!win || win.isDestroyed()) return
    if (presentFsRelease) {
      clearTimeout(presentFsRelease)
      presentFsRelease = null
    }
    if (on === true) {
      presentHooks.setBleed?.(wc, true)
      if (process.platform === 'darwin' && !win.isFullScreen()) {
        win.setFullScreenable(false)
        if (!win.isSimpleFullScreen()) win.setSimpleFullScreen(true)
      }
      // the snap can hand the first responder to the shell chrome; Esc must keep landing in the tab
      wc.focus()
      setTimeout(() => {
        if (!wc.isDestroyed()) wc.focus()
      }, 50)
      return
    }
    presentFsRelease = setTimeout(() => {
      presentFsRelease = null
      if (!wc.isDestroyed()) presentHooks.setBleed?.(wc, false)
      if (win.isDestroyed()) return
      if (process.platform === 'darwin') {
        if (win.isSimpleFullScreen()) win.setSimpleFullScreen(false)
        win.setFullScreenable(true)
      }
    }, 150)
  })

  ipcMain.handle(HTML_CHANNELS.presentNewTab, (e, title: unknown) => {
    const label = typeof title === 'string' ? title : ''
    if (presentHooks.openTab?.(e.sender, label)) return true
    const parent = BrowserWindow.fromWebContents(e.sender) ?? presentHooks.hostWindow?.(e.sender)
    const bounds =
      parent && !parent.isDestroyed() ? parent.getContentBounds() : { width: 1200, height: 850 }
    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      webPreferences: {
        preload: runtime.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    presentWindows.add(win)
    win.once('closed', () => presentWindows.delete(win))
    bindPresentView(win.webContents, e.sender.id, label)
    return true
  })

  ipcMain.handle(HTML_CHANNELS.readFile, async (e, path: unknown) => {
    if (typeof path !== 'string' || !allowedByWc.get(e.sender.id)?.has(path)) {
      throw new Error('html: path not granted to this view')
    }
    return await readFile(path, 'utf8')
  })

  ipcMain.handle(
    HTML_CHANNELS.save,
    async (e, request: SaveHtmlRequest): Promise<SaveHtmlResult> => {
      const waiter = saveWaiters.get(e.sender.id)
      saveWaiters.delete(e.sender.id)
      const done = (result: SaveHtmlResult): SaveHtmlResult => {
        waiter?.(result.ok && !('canceled' in result))
        return result
      }
      if (typeof request?.text !== 'string') {
        return done({ ok: false, error: 'html: bad save request' })
      }
      if (
        request.imageSources !== undefined &&
        (!Array.isArray(request.imageSources) ||
          request.imageSources.some((source) => typeof source !== 'string'))
      ) {
        return done({ ok: false, error: 'html: bad image references' })
      }
      const mode: SaveMode = request.mode === 'saveAs' ? 'saveAs' : 'save'
      const pathAtRequest = savePathByWc.get(e.sender.id)
      const pendingAtRequest = pathAtRequest
        ? await pendingOwnedAssetsForDocument(pathAtRequest)
        : []
      try {
        const suggestedName =
          typeof request.suggestedName === 'string' ? request.suggestedName : undefined
        const target = await resolveSaveTarget(e, mode, suggestedName)
        if (target === 'canceled') return done({ ok: true, canceled: true })
        if (!target) return done({ ok: false, error: 'html: no save target' })
        const currentPath = pathAtRequest
        const isNewPath = currentPath !== target
        const imageSources = [...(request.imageSources ?? [])]
        const knownImageSources = new Set(imageSources)
        for (const source of extractHtmlImageSources(request.text)) {
          if (knownImageSources.has(source)) continue
          knownImageSources.add(source)
          imageSources.push(source)
        }
        const prepared =
          currentPath && resolve(dirname(currentPath)) !== resolve(dirname(target))
            ? await prepareAssetsForSaveAs(currentPath, target, request.text, imageSources)
            : null
        const textToWrite = prepared?.text ?? request.text
        const savedImageSources = prepared?.imageSources ?? imageSources
        try {
          await writeTextAtomic(target, textToWrite)
        } catch (error) {
          if (prepared) await rollbackPreparedSaveAsAssets(prepared).catch(() => {})
          throw error
        }
        savePathByWc.set(e.sender.id, target)
        // keep the reload path in sync — a stale openPathByWc would make a
        // reloaded renderer load the OLD file and then save it over the new one
        openPathByWc.set(e.sender.id, target)
        const allowed = allowedByWc.get(e.sender.id) ?? new Set<string>()
        allowed.add(target)
        allowedByWc.set(e.sender.id, allowed)
        dirtyByWc.delete(e.sender.id)
        const pendingNames = prepared
          ? prepared.created.map((record) => record.name)
          : currentPath && resolve(currentPath) === resolve(target)
            ? pendingAtRequest
            : []
        const reconciled = await reconcileOwnedAssets(target, savedImageSources, { pendingNames })
        if (reconciled.errors.length > 0) {
          console.warn('[html] asset reconciliation incomplete:', reconciled.errors)
        }
        if (mode === 'saveAs' && currentPath && resolve(currentPath) !== resolve(target)) {
          const sourceResolved = await resolveSourcePendingAfterSaveAs(
            currentPath,
            pendingAtRequest,
          )
          if (sourceResolved.errors.length > 0) {
            console.warn('[html] source asset reconciliation incomplete:', sourceResolved.errors)
          }
        }
        if (isNewPath) fileSavedHook?.(e.sender, target)
        return done({
          ok: true,
          path: target,
          ...(prepared?.rewrites.length ? { imageRewrites: prepared.rewrites } : {}),
        })
      } catch (err) {
        return done({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  )

  ipcMain.handle(HTML_CHANNELS.pickImage, async (e): Promise<string | null> => {
    const docPath = savePathByWc.get(e.sender.id)
    if (!docPath) return null
    const win =
      BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const picked = await showOpenDialogWithMemory(dialog, win, {
      title: tm('dlgPickImage'),
      // only formats readImage/DOCX export can round-trip (docx-engine NewImage mimes)
      filters: [{ name: tm('filterImages'), extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
      properties: ['openFile'],
    })
    const source = picked.filePaths[0]
    if (picked.canceled || !source) return null
    return copyImageIntoOwnedAssets(docPath, source)
  })

  ipcMain.handle(
    HTML_CHANNELS.saveImage,
    async (e, data: { base64?: unknown; ext?: unknown }): Promise<string | null> => {
      const docPath = savePathByWc.get(e.sender.id)
      const ext = String(data?.ext ?? '').toLowerCase()
      if (!docPath || typeof data?.base64 !== 'string' || !data.base64) return null
      // keep in sync with readImage's MIME map — every authored asset must stay DOCX-exportable
      if (!['png', 'jpg', 'jpeg', 'gif'].includes(ext)) return null
      return writeImageIntoOwnedAssets(docPath, `image.${ext}`, Buffer.from(data.base64, 'base64'))
    },
  )

  const MIME_BY_EXT: Record<string, ImageData['mime']> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
  }

  ipcMain.handle(HTML_CHANNELS.readImage, async (e, src: unknown): Promise<ImageData | null> => {
    const docPath = savePathByWc.get(e.sender.id)
    if (!docPath || typeof src !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null
    const target = await resolveSafeRelativeImagePath(docPath, src)
    if (!target || !existsSync(target)) return null
    try {
      // "save page as, complete" assets have no extension: type them from the signature
      const mime =
        MIME_BY_EXT[extname(target).toLowerCase()] ?? editableImageMime(await readHead(target))
      if (!mime) return null
      return { base64: (await readFile(target)).toString('base64'), mime }
    } catch {
      return null
    }
  })

  // remote pictures (generated or hot-linked) are downloaded here: the frame's fetch is
  // CORS-bound, and fetchRemoteImage refuses private/link-local targets
  ipcMain.handle(HTML_CHANNELS.fetchImage, async (_e, url: unknown): Promise<ImageData | null> => {
    if (typeof url !== 'string' || !/^https?:/i.test(url)) return null
    try {
      const resp = await fetchRemoteImage(url)
      if (!resp?.ok) return null
      const ct = resp.headers.get('content-type') ?? ''
      const mime = ct.includes('png')
        ? 'image/png'
        : ct.includes('gif')
          ? 'image/gif'
          : 'image/jpeg'
      const bytes = await readBodyCapped(resp, MAX_REMOTE_IMAGE_BYTES)
      return { base64: Buffer.from(bytes).toString('base64'), mime }
    } catch {
      return null
    }
  })

  ipcMain.handle(
    HTML_CHANNELS.exportDocx,
    async (e, request: ExportDocxRequest): Promise<ExportResult> => {
      if (typeof request?.html !== 'string') {
        return { ok: false, error: 'html: bad export request' }
      }
      const win =
        BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
      // Headless export has no dialog to authorize a path; the CLI already chose one.
      const picked =
        isHeadlessMode() && typeof request.outPath === 'string' && request.outPath
          ? { canceled: false, filePath: request.outPath }
          : await showSaveDialogWithMemory(
              dialog,
              win,
              {
                defaultPath: `${exportFileName(request.suggestedName)}.docx`,
                filters: [{ name: 'Word', extensions: ['docx'] }],
              },
              configuredDefaultSaveDir(app),
            )
      if (picked.canceled || !picked.filePath) return { ok: true, canceled: true }
      if (docxExportPrepareHook && !(await docxExportPrepareHook(picked.filePath))) {
        return { ok: true, canceled: true }
      }
      const workDir = await mkdtemp(join(tmpdir(), 'genoffice-html-docx-'))
      let driver: ElectronBrowserDriver | null = null
      try {
        // Same document the preview shows (scripts on, relative assets via html-asset://):
        // html2docx extracts from the rendered DOM, not from a print.
        const docPath = savePathByWc.get(e.sender.id)
        const base = docPath ? assetBaseHref(dirname(docPath)) : null
        const htmlPath = join(workDir, 'export.html')
        await writeFile(htmlPath, buildPreviewDocument(request.html, base), 'utf8')
        driver = await ElectronBrowserDriver.create(HTML2DOCX_VIEWPORT)
        const { docx } = await convertHtmlToDocx({ url: pathToFileURL(htmlPath).href }, driver)
        await writeFile(picked.filePath, docx)
        openExportedDocx(picked.filePath)
        return { ok: true, path: picked.filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        await driver?.close()
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
    },
  )

  ipcMain.handle(
    HTML_CHANNELS.exportPdf,
    async (e, request: ExportPdfRequest): Promise<ExportResult> => {
      if (typeof request?.html !== 'string') {
        return { ok: false, error: 'html: bad export request' }
      }
      const win =
        BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
      // Headless export has no dialog to authorize a path; the CLI already chose one.
      const picked =
        isHeadlessMode() && typeof request.outPath === 'string' && request.outPath
          ? { canceled: false, filePath: request.outPath }
          : await showSaveDialogWithMemory(
              dialog,
              win,
              {
                defaultPath: `${exportFileName(request.suggestedName)}.pdf`,
                filters: [{ name: 'PDF', extensions: ['pdf'] }],
              },
              configuredDefaultSaveDir(app),
            )
      if (picked.canceled || !picked.filePath) return { ok: true, canceled: true }
      const workDir = await mkdtemp(join(tmpdir(), 'genoffice-html-pdf-'))
      try {
        const docPath = savePathByWc.get(e.sender.id)
        await writeFile(picked.filePath, await renderPrintPdf(request.html, docPath, workDir))
        openExportedPdf(picked.filePath)
        return { ok: true, path: picked.filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
    },
  )

  ipcMain.handle(
    HTML_CHANNELS.exportHtml,
    async (e, request: ExportHtmlRequest): Promise<ExportResult> => {
      if (typeof request?.html !== 'string') {
        return { ok: false, error: 'html: bad export request' }
      }
      const win =
        BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
      // Headless export has no dialog to authorize a path; the CLI already chose one.
      const picked =
        isHeadlessMode() && typeof request.outPath === 'string' && request.outPath
          ? { canceled: false, filePath: request.outPath }
          : await showSaveDialogWithMemory(
              dialog,
              win,
              {
                defaultPath: `${singleFileExportBaseName(exportFileName(request.suggestedName))}.html`,
                filters: [{ name: 'HTML', extensions: ['html'] }],
              },
              configuredDefaultSaveDir(app),
            )
      if (picked.canceled || !picked.filePath) return { ok: true, canceled: true }
      const docPath = savePathByWc.get(e.sender.id) ?? null
      // inlining the document into itself would silently rewrite the working file
      if (docPath && resolve(picked.filePath) === resolve(docPath)) {
        return { ok: false, error: 'single-file export cannot overwrite the open document' }
      }
      try {
        const { html, skipped } = await inlineImagesForSingleFile(request.html, docPath)
        await writeFile(picked.filePath, html, 'utf8')
        if (!isHeadlessMode()) shell.showItemInFolder(picked.filePath)
        return skipped.length
          ? { ok: true, path: picked.filePath, skipped }
          : { ok: true, path: picked.filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.on(HTML_CHANNELS.provisionalTitle, (e, title: unknown) => {
    if (typeof title !== 'string' || savePathByWc.has(e.sender.id)) return
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (clean) provisionalTitleHook?.(e.sender, clean)
  })

  ipcMain.on(HTML_CHANNELS.dirtyChanged, (e, dirty: unknown) => {
    if (dirty === true) dirtyByWc.add(e.sender.id)
    else dirtyByWc.delete(e.sender.id)
  })

  ipcMain.on(HTML_CHANNELS.closeSaveResult, (e, ok: unknown) => {
    const waiter = closeSaveWaiters.get(e.sender.id)
    closeSaveWaiters.delete(e.sender.id)
    waiter?.(ok === true)
  })

  ipcMain.on(HTML_CHANNELS.readTextResult, (e, result: unknown) => {
    const waiter = readTextWaiters.get(e.sender.id)
    readTextWaiters.delete(e.sender.id)
    if (!waiter) return
    if (result && typeof result === 'object' && 'text' in result) {
      waiter({ text: String((result as { text: unknown }).text) })
    } else {
      waiter({ error: 'the document could not be read' })
    }
  })

  // safety net for menu saves the renderer declined without invoking save()
  // (busy / still loading) — the save handler itself resolves the normal path
  ipcMain.on(HTML_CHANNELS.saveRequestAck, (e, ok: unknown) => {
    const waiter = saveWaiters.get(e.sender.id)
    saveWaiters.delete(e.sender.id)
    waiter?.(ok === true)
  })

  // Language channel shared with other modules; removeHandler tolerates duplicate registration
  ipcMain.removeHandler(HTML_CHANNELS.getLanguage)
  ipcMain.handle(HTML_CHANNELS.getLanguage, () => getUiLang())
}

function grantAndTrack(wc: WebContents, openPath?: string | null): void {
  const wcId = wc.id
  if (openPath && existsSync(openPath)) {
    openPathByWc.set(wcId, openPath)
    savePathByWc.set(wcId, openPath)
    allowedByWc.set(wcId, new Set([openPath]))
  }
  installExternalLinkOpener(wc)
  wc.once('destroyed', () => {
    closePresentViewsOf(wcId)
    openPathByWc.delete(wcId)
    allowedByWc.delete(wcId)
    savePathByWc.delete(wcId)
    dirtyByWc.delete(wcId)
    previewTextByWc.delete(wcId)
    closeSaveWaiters.get(wcId)?.(false)
    closeSaveWaiters.delete(wcId)
    saveWaiters.get(wcId)?.(false)
    saveWaiters.delete(wcId)
  })
}

function installExternalLinkOpener(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    const target = safeExternalUrl(url, { allowedProtocols: ['http:', 'https:', 'mailto:'] })
    if (target) void shell.openExternal(target)
    return { action: 'deny' }
  })
}

/** A present view renders only the owner's preview (renderer route `?present=<owner wc id>`) */
function bindPresentView(wc: WebContents, ownerWcId: number, title: string): void {
  const wcId = wc.id
  presentOwnerByWc.set(wcId, ownerWcId)
  installExternalLinkOpener(wc)
  wc.once('destroyed', () => presentOwnerByWc.delete(wcId))
  const query = { present: String(ownerWcId), title }
  void wc.loadURL(rendererUrl(runtime.rendererUrl, 'html', query))
}

export function createHtmlPresentView(owner: WebContents, title: string): WebContentsView {
  registerHtmlIpc()
  const view = new WebContentsView({
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  bindPresentView(view.webContents, owner.id, title)
  return view
}

/** hidden export windows: webContents id -> what the renderer must write */
const headlessExportTargets = new Map<number, HeadlessExportTarget>()
/** settled by the renderer's headless-export-done message (or by it dying) */
const headlessExportWaiters = new Map<number, (result: HeadlessHtmlReport) => void>()

interface HeadlessHtmlReport {
  ok: boolean
  error?: string
}

/**
 * Render `input` to `outPath` (PDF or Word) with no visible window: a hidden
 * html renderer opens the file through the normal pending-open queue and runs
 * the File menu's own export, which already renders in a second hidden window.
 */
export async function exportHtmlHeadless(
  input: string,
  outPath: string,
  format: HeadlessExportFormat = 'pdf',
  timeoutMs = 180_000,
): Promise<void> {
  registerHtmlIpc()
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 850,
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const wcId = win.webContents.id
  grantAndTrack(win.webContents, input)
  headlessExportTargets.set(wcId, { outPath, format })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const report = await new Promise<HeadlessHtmlReport>((resolve) => {
      headlessExportWaiters.set(wcId, resolve)
      win.webContents.on('render-process-gone', (_event, details) =>
        resolve({ ok: false, error: `html renderer stopped (${details.reason})` }),
      )
      timer = setTimeout(
        () => resolve({ ok: false, error: `html export timed out after ${timeoutMs}ms` }),
        timeoutMs,
      )
      void win.webContents.loadURL(rendererUrl(runtime.rendererUrl, 'html'))
    })
    if (!report.ok) throw new Error(report.error ?? 'html export failed')
  } finally {
    if (timer) clearTimeout(timer)
    headlessExportWaiters.delete(wcId)
    headlessExportTargets.delete(wcId)
    if (!win.isDestroyed()) win.destroy()
  }
}

export function createHtmlView(openPath?: string | null): WebContentsView {
  registerHtmlIpc()
  const view = new WebContentsView({
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  grantAndTrack(view.webContents, openPath)
  void view.webContents.loadURL(rendererUrl(runtime.rendererUrl, 'html'))
  return view
}

/** Standalone window mode: `npm run dev -w @genoffice/html`, md path passed via argv */
export function startHtmlStandalone(): void {
  registerPrivilegedSchemes()
  installNavigationGuard(app)
  installContextMenu(app, () => contextMenuLabels(getUiLang()))
  configureHtmlRuntime({
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: join(__dirname, '../renderer/index.html'),
  })
  void app.whenReady().then(() => {
    installRendererProtocol({ html: join(__dirname, '../renderer') })
    registerHtmlIpc()
    const win = new BrowserWindow({
      width: 1200,
      height: 850,
      webPreferences: {
        preload: runtime.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    const argPath = process.argv.slice(1).find((a) => /\.html?$/i.test(a) && existsSync(a))
    grantAndTrack(win.webContents, argPath)
    void win.loadURL(rendererUrl(runtime.rendererUrl, 'html'))
  })
  app.on('window-all-closed', () => app.quit())
}
