# BMS Troubleshooter PWA deployment

Keep these filenames stable in the GitHub repository:

- index.html
- output.json
- manifest.webmanifest
- service-worker.js
- icons/icon-192.png
- icons/icon-512.png
- icons/icon-maskable-192.png
- icons/icon-maskable-512.png
- supabase/functions/ai-chat/index.ts
- supabase/functions/document-library/index.ts
- .github/workflows/deploy-supabase-function.yml

## GitHub Pages
Publish the files from the same repository folder. The application uses relative paths, so it can run from a project site such as https://organization.github.io/repository/.

## Updating the app
- Replace output.json without renaming it.
- If application files change, increment CACHE_NAME inside service-worker.js and the APP_VERSION constant near the top of the index.html script. Keep `product.version` in output.json the same value.
- Commit and push the changed files.
- Installed devices download the update the next time they open the app while online. An **Apply update** bar appears and the technician applies it between cases. Saved cases stay on the device.
- If the network is slow (about 3 seconds), the app opens from its cached copy and refreshes in the background.

## Installation
- Windows/Android: open the site in a supporting browser and select Install app.
- iPhone/iPad: open the site in Safari, use Share, then choose Add to Home Screen.

The troubleshooting tree is cached for offline use. IBM Plex fonts are cached after the first online visit; system fonts are used until then. AI assistance requires network connectivity. Technician identity, troubleshooting, safety review, evidence, conclusions, and saved sessions work locally. Session logs created while offline are queued in the browser and automatically retried when the device returns online.

### Remembered technician
- The app can remember the technician name and @se.com email in local browser storage.
- This is not a password or formal authentication.
- Use Change technician to switch names.
- Use Forget on shared devices.
- Safety review remains case-specific and is not skipped.

### Offline synchronization
- If Supabase cannot be reached, the completed session log is kept in a local queue.
- The app retries this queue when the browser reports that connectivity has returned.
- The full troubleshooting case remains available in local saved sessions even if cloud logging fails.

## Issue reports (v0.6.24)
- Every question has a **Report an issue with this step** box. Reports are inserted into the `bms_feedback` table with `rating = 'step_issue'`, `result_id = STEP:<step id>:<random>`, the question text in `diagnosis_text`, the description in `comment`, and the step details in the `conclusion` JSON.
- Offline reports are queued and retried automatically. A report the cloud rejects (4xx) stays on the device and the error is shown on screen.

## Optional Supabase migration
`supabase_migration_0.6.24.sql` adds `case_id` and `log_key` to `bms_session_logs` (duplicate-proof logging) and allows `step_issue` in the feedback rating constraint if one exists. The app works without it and falls back automatically.

## Edge Functions (v0.6.24)
- The GitHub Actions workflow now deploys functions only when files under `supabase/functions/` (or the workflow itself) change. Use **Run workflow** on the Actions tab to deploy manually.
- `ai-chat` keeps the same request and response format. Optional secrets: `GEMINI_MODEL` (default gemini-2.5-flash) and `ALLOWED_ORIGINS` (comma-separated site origins, for example https://organization.github.io). If `ALLOWED_ORIGINS` is not set, any origin is allowed as before.
