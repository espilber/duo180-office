/** File-level page-operation shapes shared by the app (rotate / crop / page size / insert pages). */

export type RotateDelta = 90 | -90 | 180

export type CropRect = { l: number; t: number; r: number; b: number }

/** A native picker was dismissed; flushed = the pending edits had already been saved to disk first */
export type FileOpCanceled = { ok: true; canceled: true; flushed: boolean }

/** In-place rewrite: pageCount is read from the reloaded document */
export type FileOpResult =
  | { ok: true; pageCount: number }
  | FileOpCanceled
  | { ok: false; error: string }
