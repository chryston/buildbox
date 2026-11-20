/**
 * Handing a finished file to the browser as a download (#50, #14, #20 §10).
 *
 * One anchor element, one object URL, one click. There is deliberately no File System Access
 * picker: #20 §10 puts it out of scope, and a download is the one write here that needs no
 * permission to be honest about — BuildBox sees the bytes leave and never sees where they land,
 * which is exactly what #14 makes the copy say.
 *
 * `start` returns as soon as the browser has the bytes. That instant is the moment
 * `markBackupInitiated` is allowed to record, and the caller relies on this function not waiting
 * for something it cannot observe.
 */
import type { DownloadPort } from '../session'

/**
 * Saving bytes under a name, whatever they are.
 *
 * `createDownload` below is the Backup's port and always says `application/zip`. A drawing is not
 * a Backup: a `.pdf` that arrives as `application/octet-stream` opens in a text editor, and a
 * `.svg` that arrives as `image/png` is a broken image. So the media type is an argument here and
 * the port is one line of it.
 */
export function downloadFile(fileName: string, mediaType: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: mediaType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  // Firefox will not click an element that is not in the document.
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

/**
 * A `DownloadPort` that saves through an anchor.
 *
 * The object URL is revoked on the next task rather than immediately: the browser reads the blob
 * asynchronously, and revoking before it has started is the classic way to produce a download of
 * zero bytes.
 */
export function createDownload(): DownloadPort {
  return {
    start(fileName: string, bytes: Uint8Array): void {
      downloadFile(fileName, 'application/zip', bytes)
    },
  }
}
