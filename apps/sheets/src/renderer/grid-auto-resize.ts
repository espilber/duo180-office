import { IUniverInstanceService, UniverInstanceType, type UnitModel } from '@univerjs/core'
import { IRenderManagerService } from '@univerjs/engine-render'

/**
 * Keeps the workbook canvas at the size of its container.
 *
 * The render engine measures `#univer-container` once while it boots, so a
 * workbook that is opened before the window layout has settled (or a window
 * that is later maximized, restored or moved to another display) keeps drawing
 * into the old, smaller canvas: the sheet surface ends mid-window while the
 * app chrome stays full width. Nothing in the app called `Engine.resize()`, so
 * the size never caught up — not even on a real window resize.
 *
 * This installs that missing nudge: an immediate resize, a short burst over
 * the following frames (the workbook is loading then), a bounded late-load
 * safety net, and one resize per animation frame on container/window changes.
 * Returns a disposer; every step degrades to a no-op if the engine is not
 * ready yet.
 */
export function installGridAutoResize(
  runtime: { univer: { __getInjector(): unknown } },
  container: HTMLElement | null,
): () => void {
  let renderManager: IRenderManagerService | null = null
  let instanceService: IUniverInstanceService | null = null
  try {
    const injector = runtime.univer.__getInjector() as { get(token: unknown): unknown }
    renderManager = injector.get(IRenderManagerService) as IRenderManagerService
    instanceService = injector.get(IUniverInstanceService) as IUniverInstanceService
  } catch {
    // Univer is not booted far enough to resolve services: nothing to resize
    return () => undefined
  }
  if (!renderManager || !instanceService) return () => undefined

  const resizeNow = (): void => {
    try {
      const unit = instanceService?.getCurrentUnitOfType<UnitModel>(
        UniverInstanceType.UNIVER_SHEET,
      )
      const render = unit ? renderManager?.getRenderById(unit.getUnitId()) : null
      render?.engine.resize()
    } catch {
      // the render unit may not exist yet (workbook still loading): retried later
    }
  }

  let frame = 0
  const schedule = (): void => {
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      resizeNow()
    })
  }

  // boot burst: the canvas is measured while the workbook loads, so a single
  // call would land too early
  const burst = [0, 1, 4, 12].map((n) => window.setTimeout(schedule, n * 50))

  // late-load safety net: opening a file after mount does not necessarily
  // change the container's size, so the observer alone would not fire
  let ticks = 0
  const lateLoad = window.setInterval(() => {
    schedule()
    if (++ticks >= 12) window.clearInterval(lateLoad)
  }, 1000)

  window.addEventListener('resize', schedule)
  const observer =
    typeof ResizeObserver !== 'undefined' && container ? new ResizeObserver(schedule) : null
  observer?.observe(container!)
  schedule()

  return () => {
    if (frame) window.cancelAnimationFrame(frame)
    for (const id of burst) window.clearTimeout(id)
    window.clearInterval(lateLoad)
    window.removeEventListener('resize', schedule)
    observer?.disconnect()
  }
}
