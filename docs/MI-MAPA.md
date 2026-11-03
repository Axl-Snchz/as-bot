# Mapa de OpenBot — guía para personalizarlo

Basado en el código de `nightly-labs/openbot` v0.59 (commit del 2 nov 2026). Colócalo en `C:\AS_Repos\openbot\docs\MI-MAPA.md` (el script de instalación lo copia solo).

## 1. Lo esencial

| Pieza | Tecnología |
|---|---|
| App de escritorio | Electron 44 |
| Interfaz | **SolidJS** (no React) + Tailwind 4 + Kobalte (vía `@openbot/ui`) |
| Lenguaje | TypeScript 7 |
| Gestor de paquetes | **Bun 1.4.2** (fijo en `package.json`) |
| Node | ≥ 24 |
| Lint/format | Biome (único permitido) + reglas GritQL anti-slop |
| Base de datos local | SQLite → `%APPDATA%\OpenBot\openbot.db` |
| Lógica de backend | Effect 4.0 |

Licencia **PolyForm Noncommercial**: puedes modificar todo para uso personal; no vender ni usar comercialmente.

## 2. Carpetas que importan

```
src/
  renderer/   ← TODA la interfaz (SolidJS). Aquí harás la mayoría de cambios visuales
    src/features/<dominio>/   pantallas por área (sidebar, conversation, agents, settings, onboarding…)
    src/styles.css            orden de hojas de estilo (la cascada)
    src/styles/app-shell.css  capa de tema compartida
  main/       ← Electron: ventanas, IPC seguro, servidor host, adaptadores del SO
  preload/    ← puente tipado main ↔ renderer (sin lógica)
  backend/    ← runtime de agentes, proveedores (Claude, Codex, ACP…), colas, navegador embebido
packages/
  ui/         ← componentes base (Button, Text, Dialog…) — la UI SOLO importa de aquí
  brand/      ← logos, avatares y TOKENS DE DISEÑO (colores, tamaños)
  contracts/  ← tipos compartidos y validación (sin dependencias de Electron/Solid)
  i18n/       ← textos en todos los idiomas
apps/         ← web, móvil (Expo), workers de Cloudflare — puedes ignorarlos al inicio
docs/         ← documentación de arquitectura (léela antes de cambios grandes)
```

Reglas de dependencias (Biome las hace cumplir): el renderer **no puede** importar `src/main` ni `src/backend`; todo cruza por `packages/contracts` + preload.

## 3. Cambiar el diseño (lo más rápido)

1. **Colores / tema:** `packages/brand/src/tokens.css` (oscuro, por defecto) y `packages/brand/src/tokens-light.css` (claro). Todos los colores son variables `--openbot-*`. Cambiar aquí = cambia toda la app.
2. **Tamaños de controles:** escala de 24/28/32/36 px, definida en la guía `docs/ui-foundation.md`.
3. **Una pantalla concreta:** `src/renderer/src/features/<dominio>/<dominio>.css` + sus `.tsx`.
   - Barra lateral: `features/sidebar/`
   - Chat del agente: `features/conversation/` (`ConversationView.tsx`, `ConversationComposer.tsx`, `ConversationTimeline.tsx`, `AgentSettingsPanel.tsx`)
   - Configuración: `features/settings/`
   - Primer inicio: `features/onboarding/`
4. **Componentes base:** `packages/ui/src/` (`button.tsx`, `message.tsx`, `bubble.tsx`…). Prohibido importar Kobalte o Lucide directo en una feature.
5. **Ver componentes aislados:** `bun run storybook`.

## 4. Copilot en OpenBot — SIN tocar código

Copilot no es un proveedor integrado, pero OpenBot soporta **agentes ACP personalizados** (`features/custom-agents`) y **Copilot CLI tiene modo ACP** (public preview desde ene 2026):

- En OpenBot: Settings → Custom agents → agregar → comando `copilot`, argumentos `--acp`.
- Requiere tener Copilot CLI instalado (`npm install -g @github/copilot`) y con sesión iniciada.
- Docs: `docs/architecture/providers.md#custom-agents`.

Si después lo quieres como proveedor "de primera clase" (con logo y su fila en la configuración), los 9 pasos están en `docs/architecture/integrations.md#add-a-provider` (descriptor en `packages/contracts/src/agent-providers.ts`, driver en `src/backend/provider-drivers.ts`, etc.).

## 5. Agregar funciones

| Quiero… | Dónde empezar |
|---|---|
| Nueva pantalla o panel | `src/renderer/src/features/<nuevo>/` + registrar en `WorkspaceShell.tsx` / `navigation.tsx` |
| Nueva acción que toca archivos/SO | backend o main → canal IPC en `packages/contracts` → preload → renderer |
| Plantillas de agentes propias | `features/agent-templates/` + `docs/architecture/agents.md#agent-templates` |
| Rutinas / tareas programadas | `features/routine-flows/`, `features/schedule/` |
| Skills y MCP | `docs/architecture/skills-and-plugins.md` |
| Textos nuevos | `packages/i18n` (todos los idiomas) |

## 6. Comandos (Windows)

```powershell
cd C:\AS_Repos\openbot
bun install --frozen-lockfile   # dependencias
bun run dev                     # abre la app en modo desarrollo
bun run storybook               # catálogo de componentes
bun run typecheck               # revisar tipos
bun run check                   # lint + tipos + tests (lento)
```

## 7. Reglas del repo que debes respetar (AGENTS.md)

- **Migraciones de BD irreversibles**: no rompas `openbot.db` (no hay backup automático).
- No debilitar el aislamiento renderer ↔ main (sandbox, IPC validado).
- Nunca registrar secretos en logs.
- Mantener la licencia PolyForm Noncommercial.
- Claude Code lee `AGENTS.md` solo: pídele que lo respete y que use `TASKS.md` como checklist.

## 8. Cómo encaja REA

REA **no** se usa en este repo (el código fuente ya está completo; tu skill lo dice). Úsalo para analizar apps cerradas — p. ej. **grok-bot** (`C:\Program Files\Grok bot`) — y traer sus ideas a tu OpenBot.

## 9. Mantenerte al día con el original

```powershell
git remote add upstream https://github.com/nightly-labs/openbot.git   # si clonaste tu fork
git fetch upstream; git merge upstream/main
```
El proyecto cambia a diario: haz tus cambios en ramas propias y concentrados en `features/` y `tokens.css` para que los merges duelan menos.
