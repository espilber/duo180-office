import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A shell-created blank PDF lives only in memory until its first save: the
 * renderer loads blank bytes (read-blank), and save({ path: '' }) asks for a
 * destination (Save As) instead of writing anything on creation. Dismissing the
 * dialog leaves the disk untouched.
 */

type IpcHandler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown
const handlers = new Map<string, IpcHandler>()

interface FakeWebContents {
  id: number
  once: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  listeners: Map<string, () => void>
}

let nextWcId = 1
let lastWebContents: FakeWebContents

function makeFakeWebContents(): FakeWebContents {
  const listeners = new Map<string, () => void>()
  const wc: FakeWebContents = {
    id: nextWcId++,
    listeners,
    once: vi.fn((event: string, handler: () => void) => {
      listeners.set(event, handler)
    }),
    on: vi.fn((event: string, handler: () => void) => {
      listeners.set(event, handler)
    }),
    setWindowOpenHandler: vi.fn(),
    loadURL: vi.fn(),
  }
  lastWebContents = wc
  return wc
}

vi.mock('electron', () => ({
  app: { on: vi.fn(), whenReady: vi.fn(() => new Promise(() => {})) },
  dialog: { showSaveDialog: vi.fn() },
  shell: {},
  BrowserWindow: class {
    static fromWebContents(): null {
      return null
    }
  },
  WebContentsView: class {
    webContents = makeFakeWebContents()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn(),
  },
}))

import { dialog } from 'electron'
import { PDF_CHANNELS } from '../src/shared/ipc'
import type { SavePdfRequest, SavePdfResult } from '../src/shared/ipc'
import {
  configurePdfRuntime,
  createPdfView,
  setPdfFileSavedHook,
  setPdfSaveDirResolver,
  setPdfRenamedHook,
} from '../src/main/pdf-main'

const showSaveDialog = dialog.showSaveDialog as unknown as ReturnType<typeof vi.fn>

const dirs = new Set<string>()
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-untitled-'))
  dirs.add(dir)
  return dir
}

const invoke = (channel: string, wcId: number, ...args: unknown[]) =>
  handlers.get(channel)?.({ sender: { id: wcId } }, ...args)

const blankBytes = (wcId: number) =>
  invoke(PDF_CHANNELS.readBlank, wcId) as Promise<ArrayBuffer | null>

const save = (wcId: number, request: SavePdfRequest) =>
  invoke(PDF_CHANNELS.save, wcId, request) as Promise<SavePdfResult>

const emptyEdits = (overrides: Partial<SavePdfRequest> = {}): SavePdfRequest => ({
  path: '',
  markups: [],
  drawings: [],
  formValues: [],
  stamps: [],
  ...overrides,
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  setPdfRenamedHook(() => {})
  setPdfFileSavedHook(null)
  setPdfSaveDirResolver(null)
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.clear()
})

describe('untitled (pathless) pdf', () => {
  it('serves blank bytes to a pathless view and none to a path-backed view', async () => {
    configurePdfRuntime({ preloadPath: '' })
    const path = join(makeTempDir(), 'doc.pdf')
    createPdfView(path)
    expect(await blankBytes(lastWebContents.id)).toBeNull()

    createPdfView()
    const blank = await blankBytes(lastWebContents.id)
    expect(blank).not.toBeNull()
    expect(Buffer.from(blank!).subarray(0, 5).toString()).toBe('%PDF-')

    // read-blank is idempotent across reloads (same cached bytes)
    const again = await blankBytes(lastWebContents.id)
    expect(again!.byteLength).toBe(blank!.byteLength)
  })

  it('writes nothing and reports a dismissal when Save As is cancelled', async () => {
    configurePdfRuntime({ preloadPath: '' })
    const dir = makeTempDir()
    setPdfSaveDirResolver(() => dir)
    const savedHook = vi.fn()
    setPdfFileSavedHook(savedHook)
    createPdfView()
    const wcId = lastWebContents.id

    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined })
    const result = await save(wcId, emptyEdits({ defaultSaveName: 'Report' }))
    expect(result).toEqual({ ok: true, canceled: true })
    expect(savedHook).not.toHaveBeenCalled()
    expect(handlers.get(PDF_CHANNELS.consumePending)?.({ sender: { id: wcId } })).toBeNull()
    expect(await blankBytes(wcId)).not.toBeNull()
  })

  it('saves the blank document to the picked path and adopts it', async () => {
    configurePdfRuntime({ preloadPath: '' })
    const dir = makeTempDir()
    setPdfSaveDirResolver(() => dir)
    const target = join(dir, 'Report.pdf')
    const savedHook = vi.fn(() => target)
    setPdfFileSavedHook(savedHook)
    createPdfView()
    const wcId = lastWebContents.id

    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const result = await save(wcId, emptyEdits({ defaultSaveName: 'Report' }))
    expect(result).toMatchObject({ ok: true, path: target })
    expect(existsSync(target)).toBe(true)
    expect(savedHook).toHaveBeenCalledWith(expect.objectContaining({ id: wcId }), target)

    // The view now owns the file: pending resolves to it, blank bytes are gone
    expect(handlers.get(PDF_CHANNELS.consumePending)?.({ sender: { id: wcId } })).toBe(target)
    expect(await blankBytes(wcId)).toBeNull()
  })
})
