### Changed

- Custom-agent rail usage now detects local Copilot agents by executable basename, shows the Copilot logo, and polls quota every five minutes even with no usage prompt.
- Copilot rail usage now reuses the shared built-in usage ring/popover UI with a standard `Usage` header, provider row, and one `Monthly` window. The ring and bar now show **remaining** quota from GitHub-reported counters (`100 - used / entitlement`) over a locally implemented SDK RPC protocol.
- The custom Copilot popover removed former credits/USD/shared-budget text rows and now shows only the standard countdown reset line, with day-1 UTC fallback kept as native reset timestamp behavior when SDK reset date is missing or stale.
- Estimated monthly renewals now use next-month day 1 at 00:00 UTC for fallback and format that timestamp in the user’s local time, so negative-offset locales (for example America/Mexico_City) can correctly show Nov 30 evening for a Dec 1 UTC reset.
- Custom-agent usage UI now handles Copilot `ready`, `error`, and `no-data` quota states with localized messaging across all translated desktop locales.
