// The preview-start line of the e2e harness (e2e/support/previewStartReporter.js, T6 of docs/LESSONS.md): count, p95 and max of the
// seconds a Preview child took to say "Your app is running.", printed once at the end of a run.
import { afterEach, describe, expect, it, vi } from 'vitest'
import Reporter, { PREVIEW_START, PREVIEW_START_TIMEOUT, percentile, previewStartLine } from '../../e2e/support/previewStartReporter.js'

describe('previewStartLine', () => {
  it('uses the nearest rank for the percentile', () => {
    expect(percentile([], 95)).toBe(0)
    expect(percentile([4], 95)).toBe(4)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 50)).toBe(5)
  })

  it('prints count, p95 and max against the 30 s wait, and nothing for a run with no preview', () => {
    expect(previewStartLine([])).toBeNull()
    expect(previewStartLine([9.5, 11, 10.25])).toBe('[preview-start] count=3 timeouts=0 p95=11.0s max=11.0s (the harness waits 30 s)')
    expect(previewStartLine([], 30, 2)).toBe('[preview-start] count=0 timeouts=2 p95=0.0s max=0.0s (the harness waits 30 s)')
    expect(previewStartLine([12], 30, 1)).toBe('[preview-start] count=1 timeouts=1 p95=12.0s max=12.0s (the harness waits 30 s)')
  })
})

describe('the reporter', () => {
  afterEach(() => vi.restoreAllMocks())

  it('collects the preview-start annotations of every test and prints one line in onEnd', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = new Reporter()
    r.onTestEnd({ annotations: [{ type: PREVIEW_START, description: '9.50' }, { type: 'other', description: '1' }] })
    r.onTestEnd({ annotations: [{ type: PREVIEW_START, description: 'not a number' }] })
    r.onTestEnd({ annotations: [{ type: PREVIEW_START, description: '12.00' }] })
    r.onEnd()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[preview-start] count=2 timeouts=0 p95=12.0s max=12.0s (the harness waits 30 s)')
  })

  it('counts a start that hit the 30 s wait, and reads each attempt\'s own annotations so a retry does not double count', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = new Reporter()
    // Playwright's test.annotations can carry the earlier attempt's entries; the attempt's result holds only its own.
    const carried = [{ type: PREVIEW_START_TIMEOUT, description: '30' }]
    r.onTestEnd({ annotations: carried }, { annotations: [{ type: PREVIEW_START_TIMEOUT, description: '30' }] })
    r.onTestEnd({ annotations: [...carried, { type: PREVIEW_START, description: '8.00' }] }, { annotations: [{ type: PREVIEW_START, description: '8.00' }] })
    r.onEnd()
    expect(r.timeouts).toBe(1)
    expect(r.seconds).toEqual([8])
    expect(log).toHaveBeenCalledWith('[preview-start] count=1 timeouts=1 p95=8.0s max=8.0s (the harness waits 30 s)')
  })

  it('prints a line for a run whose only starts timed out', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = new Reporter()
    r.onTestEnd({ annotations: [] }, { annotations: [{ type: PREVIEW_START_TIMEOUT, description: '30' }] })
    r.onEnd()
    expect(log).toHaveBeenCalledWith('[preview-start] count=0 timeouts=1 p95=0.0s max=0.0s (the harness waits 30 s)')
  })

  it('prints nothing when no test started a preview', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = new Reporter()
    r.onTestEnd({ annotations: [] })
    r.onEnd()
    expect(log).not.toHaveBeenCalled()
  })
})
