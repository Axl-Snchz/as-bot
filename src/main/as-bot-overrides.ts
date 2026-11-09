// AS Bot fork only. Upstream never has this file, so merges of official releases do not conflict on it.
// `index.ts` calls `applyAsBotIdentity` once, right after the official name and AppUserModelId.
// Updates come from the fork through `publish` in electron-builder.yml, not from this file.
import { join } from "node:path";
import { app } from "electron";

/** Do not change: real user data and build/installer.nsh depend on this path. */
const PACKAGED_USER_DATA_DIRECTORY = "OpenBot";

/**
 * Replaces the official app identity with the AS Bot identity. Call it before anything reads
 * `userData` and before the single-instance lock. `commandLineUserDataDirectory` is the trimmed
 * `--user-data-dir` value; when it is set, or in development, `index.ts` already chose `userData`.
 */
export function applyAsBotIdentity(commandLineUserDataDirectory: string): void {
  // productName "AS Bot" would move the packaged default to %APPDATA%\AS Bot and lose the user data.
  if (!commandLineUserDataDirectory && app.isPackaged)
    app.setPath("userData", join(app.getPath("appData"), PACKAGED_USER_DATA_DIRECTORY));
  app.setName("AS Bot");
  if (process.platform === "win32") app.setAppUserModelId("com.asbot.desktop");
}
