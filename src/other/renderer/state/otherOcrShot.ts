/** Session OCR picture. Writes userData/other-ocr-session/<jobId>.png */
export function saveSessionOcrShot(jobId: string, dataUrl: string | null | undefined): void {
  if (!jobId || !dataUrl) return
  void window.supercargo.saveOtherOcrShot?.(jobId, dataUrl)
}
