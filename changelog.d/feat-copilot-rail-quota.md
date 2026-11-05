### Changed

- Custom-agent rail usage now detects local Copilot agents by executable basename, shows the Copilot logo, and polls quota every five minutes even with no usage prompt.
- Copilot rail usage now renders a quota ring from SDK counters (`used / entitlement`), localized credit and USD values, shared-budget note, and estimated day-1 renewal fallback when reset date is missing or stale.
- Estimated monthly renewals now compute a timezone-consistent day-1 calendar date so negative-offset locales (for example America/Mexico_City) do not render day 30/31.
- Custom-agent usage UI now handles Copilot `ready`, `error`, and `no-data` quota states with localized messaging across all translated desktop locales.
