import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  // Native window titles.
  "window.localHostTitle": "AS Bot ローカルホスト",
  "window.localClientTitle": "AS Bot ローカルクライアント",
  "window.computerUsePermissionTitle": "Computer Use をオンにする",
} as const satisfies PartialTranslation<typeof source>;
