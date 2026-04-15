# Verificacion funcional frontend/backend

## Comandos

- `corepack pnpm test:e2e`
- `corepack pnpm test:e2e:staging`
- `corepack pnpm auth:staging:login`
- `corepack pnpm auth:staging:token`

## Que cubre local

- navegacion por tabs principales
- dashboard con categorizacion y persistencia tras reload
- upload real de CSV + carga manual
- creacion/borrado de reglas
- cuentas, links, ahorro, cuotas y assistant

## Dataset local

Los tests resetean el tenant local `dev-user` via `POST /api/system/test/reset`.

Eso:

- limpia datos previos del usuario de desarrollo
- vuelve a sembrar categorias, reglas y settings base
- crea cuentas, transacciones, uploads e installments deterministas
- deja la suscripcion del tenant en `pro_monthly` para no bloquear flows por limites durante e2e

La route existe solo en `APP_ENV=local`.

## Remoto / smoke

Variables soportadas:

- `E2E_STAGING_WEB_URL`
- `E2E_STAGING_API_URL`
- `E2E_STAGING_BEARER_TOKEN`
- `E2E_STAGING_STORAGE_STATE`

Si no se pasan URLs, la suite remota usa por defecto:

- web: `https://smartfinance-saas-web.pages.dev`
- api: `https://smartfinance-saas-api-production.nazarenocabrerati.workers.dev`

### Smoke API

Siempre valida:

- `health`
- `schema`
- que endpoints protegidos devuelvan `401` sin token

Si ademas existe `E2E_STAGING_BEARER_TOKEN`, ejecuta smoke autenticado contra:

- `accounts`
- `summary`
- `uploads`
- `assistant`

### Smoke UI

Sin sesion autenticada, el smoke valida que la web remota resuelva a uno de estos estados:

- shell autenticado
- pantalla de auth
- warning explicito de configuracion cloud

## Guia rapida para cerrar el smoke autenticado

### 1. Guardar una sesion de Clerk

Si ya habias corrido el helper antes, borra cualquier archivo viejo:

```powershell
Remove-Item .auth/staging-storage-state.json -ErrorAction SilentlyContinue
```

Corre:

```powershell
corepack pnpm auth:staging:login
```

Eso abre Chromium, te deja loguearte manualmente y guarda la sesion en:

```txt
.auth/staging-storage-state.json
```

Importante: ahora el helper espera a que aparezca la app autenticada real; no deberia guardar una sesion vacia.

### 2. Extraer el bearer token desde esa sesion

Corre:

```powershell
corepack pnpm auth:staging:token
```

Eso:

- abre la web con la sesion guardada
- extrae el token de Clerk
- lo imprime en consola
- lo guarda en:

```txt
.auth/staging-bearer-token.txt
```

### 3. Ejecutar el smoke autenticado

En PowerShell:

```powershell
$env:E2E_STAGING_STORAGE_STATE = (Resolve-Path .auth/staging-storage-state.json)
$env:E2E_STAGING_BEARER_TOKEN = (Get-Content .auth/staging-bearer-token.txt -Raw).Trim()
corepack pnpm test:e2e:staging
```

Si queres ser explicito con URLs:

```powershell
$env:E2E_STAGING_WEB_URL = "https://smartfinance-saas-web.pages.dev"
$env:E2E_STAGING_API_URL = "https://smartfinance-saas-api-production.nazarenocabrerati.workers.dev"
```
