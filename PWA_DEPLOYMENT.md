# BMS Troubleshooter PWA deployment

Keep these filenames stable in the GitHub repository:

- `index.html`
- `output.json`
- `manifest.webmanifest`
- `service-worker.js`
- `icons/icon-192.png`
- `icons/icon-512.png`
- `icons/icon-maskable-192.png`
- `icons/icon-maskable-512.png`

## GitHub Pages

Publish the files from the same repository folder. The application uses relative paths, so it can run from a project site such as `https://organization.github.io/repository/`.

## Updating the app

1. Replace `output.json` without renaming it.
2. If application files change, increment `CACHE_NAME` inside `service-worker.js`.
3. Commit and push the changed files.
4. Installed devices receive the new files when they next open the app while online.

## Installation

- Windows/Android: open the site in a supporting browser and select **Install app**.
- iPhone/iPad: open the site in Safari, use **Share**, then choose **Add to Home Screen**.

The troubleshooting tree is cached for offline use. AI assistance requires network connectivity. Technician identity, troubleshooting, safety review, evidence, conclusions, and saved sessions work locally. Session logs created while offline are queued in the browser and automatically retried when the device returns online.


### Remembered technician
- The app can remember the technician name and @se.com email in local browser storage.
- This is not a password or formal authentication.
- Use **Change technician** to switch names.
- Use **Forget** on shared devices.
- Safety review remains case-specific and is not skipped.

### Offline synchronization
- If Supabase cannot be reached, the completed session log is kept in a local queue.
- The app retries this queue when the browser reports that connectivity has returned.
- The full troubleshooting case remains available in local saved sessions even if cloud logging fails.
