/**
 * Live accept auto-OCR is scheduled in otherJobs onOtherAccepted (2s delay).
 * This bind used to wrap addJob/ingestAccepted and double-fired the modal.
 */
export function bindOtherAutoOcr(): void {
  /* live path lives on onOtherAccepted + requestAutoOcrIfEnabled */
}
