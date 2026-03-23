# Finance Tracker: especificacion completa del proyecto

## Contexto

App de finanzas personales para uso individual. El usuario sube PDFs o screenshots de resúmenes bancarios. La app extrae las transacciones crudas (fecha, monto, descripción del banco) y le pregunta al usuario qué es cada gasto. El usuario le asigna una categoría y una descripción propia. La app guarda esa asociación como "regla" y la próxima vez que detecte la misma descripción del banco, la categoriza automáticamente.

La app debe poder recibir múltiples uploads del mismo mes (resumen parcial, screenshots a mitad de mes, etc.) y mergear sin duplicar transacciones. El matching de duplicados es por combinación de fecha + monto + descripción.

## Stack técnico

1. Backend: Node.js (v18+) con Express.js.
2. Base de datos: SQLite via `better-sqlite3`. Zero config, un solo archivo `.db`. No usar ORMs, queries directas.
3. PDF parsing: `pdf-parse` para extraer texto raw. No se esperan datos estructurados del PDF, solo texto crudo que luego se parsea con regex configurables.
4. Frontend: React (Vite como bundler) + Recharts para gráficos + Tailwind CSS para estilos.
5. Comunicación: REST API JSON entre frontend y backend.
6. Monorepo simple: carpeta `server/` y carpeta `client/` con un `package.json` raíz que tiene scripts para correr ambos.

## Estructura del proyecto

```
finance-tracker/
├── package.json              # scripts: dev, server, client, build
├── CLAUDE.md                 # este archivo
├── server/
│   ├── package.json
│   ├── index.js              # Express server, puerto 3001
│   ├── db.js                 # SQLite setup, migraciones, helpers
│   ├── routes/
│   │   ├── transactions.js   # CRUD transacciones + filtros por período
│   │   ├── categories.js     # CRUD categorías con presupuesto y tipo fijo/variable
│   │   ├── accounts.js       # CRUD cuentas/tarjetas
│   │   ├── rules.js          # CRUD reglas de auto-categorización
│   │   ├── installments.js   # CRUD compras en cuotas
│   │   ├── savings.js        # Config de ahorro (capital inicial, objetivo, moneda)
│   │   ├── settings.js       # Tipo de cambio y preferencias globales
│   │   ├── upload.js         # Upload de PDF/imagen + parsing + merge
│   │   └── export.js         # Exportación CSV
│   └── services/
│       ├── pdf-parser.js     # Extrae texto raw del PDF con pdf-parse
│       ├── tx-extractor.js   # Aplica regex al texto para extraer transacciones
│       ├── categorizer.js    # Motor de auto-categorización por reglas
│       └── dedup.js          # Deduplicación al mergear uploads
├── client/
│   ├── package.json
│   ├── vite.config.js        # proxy /api → localhost:3001
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx           # Router principal con tabs
│       ├── api.js            # Funciones fetch centralizadas al backend
│       ├── utils.js          # Formateo de moneda, fechas, porcentajes
│       ├── pages/
│       │   ├── Dashboard.jsx
│       │   ├── Upload.jsx
│       │   ├── Savings.jsx
│       │   ├── Accounts.jsx
│       │   ├── Installments.jsx
│       │   └── Rules.jsx
│       └── components/
│           ├── PeriodSelector.jsx
│           ├── MetricCard.jsx
│           ├── BudgetBar.jsx
│           ├── Badge.jsx
│           ├── TransactionTable.jsx
│           ├── CategorySelect.jsx
│           └── ExportButton.jsx
└── uploads/                  # PDFs e imágenes subidos (gitignored)
```

## Modelo de datos (SQLite)

### Tabla `accounts`
```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,           -- slug: "brou_uyu", "visa_gold"
  name TEXT NOT NULL,            -- "BROU Caja de Ahorro"
  currency TEXT NOT NULL,        -- "UYU", "USD", "ARS"
  balance REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Tabla `categories`
```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,       -- "Supermercado", "Transporte"
  budget REAL DEFAULT 0,           -- presupuesto mensual
  type TEXT DEFAULT 'variable',    -- "fijo" o "variable"
  color TEXT,                      -- hex color para gráficos
  sort_order INTEGER DEFAULT 0
);
```

### Tabla `transactions`
```sql
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,              -- "2026-03-15" (ISO format)
  desc_banco TEXT NOT NULL,         -- descripción original del banco
  desc_usuario TEXT,                -- descripción que le puso el usuario
  monto REAL NOT NULL,              -- negativo = gasto, positivo = ingreso
  moneda TEXT NOT NULL DEFAULT 'UYU',
  category_id INTEGER,             -- FK → categories.id (NULL si pendiente)
  account_id TEXT,                  -- FK → accounts.id
  es_cuota INTEGER DEFAULT 0,      -- 1 si es pago de cuota
  installment_id INTEGER,          -- FK → installments.id si aplica
  upload_id INTEGER,               -- FK → uploads.id (de qué archivo vino)
  dedup_hash TEXT,                  -- hash para deduplicación (fecha+monto+desc_banco)
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (installment_id) REFERENCES installments(id)
);
CREATE INDEX idx_tx_fecha ON transactions(fecha);
CREATE INDEX idx_tx_dedup ON transactions(dedup_hash);
```

### Tabla `rules`
```sql
CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,            -- texto que matchea en desc_banco (case insensitive, substring)
  category_id INTEGER NOT NULL,     -- FK → categories.id
  match_count INTEGER DEFAULT 0,    -- cuántas veces matcheó
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
```

### Tabla `installments`
```sql
CREATE TABLE installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descripcion TEXT NOT NULL,        -- "Heladera Samsung"
  monto_total REAL NOT NULL,
  cantidad_cuotas INTEGER NOT NULL,
  cuota_actual INTEGER NOT NULL,    -- en qué cuota va
  monto_cuota REAL NOT NULL,        -- monto_total / cantidad_cuotas
  account_id TEXT,                  -- FK → accounts.id
  start_month TEXT,                 -- "2026-01" (mes de la primera cuota)
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
```

### Tabla `uploads`
```sql
CREATE TABLE uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  account_id TEXT,                  -- de qué cuenta viene este archivo
  tx_count INTEGER DEFAULT 0,      -- cuántas transacciones se extrajeron
  period TEXT,                      -- "2026-03" (mes al que corresponden)
  status TEXT DEFAULT 'pending',    -- "pending", "processed"
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Tabla `settings`
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- Valores iniciales:
-- exchange_rate_usd_uyu: "42.5"
-- display_currency: "UYU"
-- savings_initial: "50000"
-- savings_goal: "200000"
-- savings_currency: "UYU"
```

## API REST (endpoints)

Todos los endpoints usan prefix `/api`. Responses en JSON. Errors devuelven `{ error: "mensaje" }` con status code apropiado.

### Transactions
1. `GET /api/transactions?month=2026-03` — lista transacciones del período. Soporta query params: `month` (requerido, formato YYYY-MM), `account_id` (opcional), `category_id` (opcional).
2. `GET /api/transactions/pending?month=2026-03` — solo transacciones sin categorizar del período.
3. `PUT /api/transactions/:id` — actualizar categoría, descripción del usuario, o cuenta. Body: `{ category_id, desc_usuario, account_id }`. Al categorizar, si no existe una regla para ese `desc_banco`, crear una regla automáticamente.
4. `GET /api/transactions/summary?month=2026-03` — resumen agregado: total ingresos, total gastos, gastos por categoría, gastos por tipo (fijo/variable), comparación con mes anterior (deltas porcentuales).
5. `GET /api/transactions/monthly-evolution?months=6&end=2026-03` — serie temporal de ingresos y gastos por mes para los últimos N meses.

### Categories
1. `GET /api/categories` — lista todas con presupuesto y tipo.
2. `PUT /api/categories/:id` — actualizar presupuesto, tipo (fijo/variable), color, nombre.
3. `POST /api/categories` — crear nueva. Body: `{ name, budget, type, color }`.
4. `DELETE /api/categories/:id` — borrar (solo si no tiene transacciones asociadas).

### Accounts
1. `GET /api/accounts` — lista todas con balance actual y moneda.
2. `POST /api/accounts` — crear. Body: `{ id, name, currency, balance }`.
3. `PUT /api/accounts/:id` — actualizar balance o nombre.
4. `DELETE /api/accounts/:id` — borrar (solo si no tiene transacciones).
5. `GET /api/accounts/consolidated` — patrimonio total unificado en la moneda de display.

### Rules
1. `GET /api/rules` — lista todas con nombre de categoría.
2. `POST /api/rules` — crear. Body: `{ pattern, category_id }`.
3. `DELETE /api/rules/:id` — borrar.

### Installments
1. `GET /api/installments` — lista activas (cuota_actual <= cantidad_cuotas).
2. `POST /api/installments` — crear. Body: `{ descripcion, monto_total, cantidad_cuotas, account_id, start_month }`. Calcula monto_cuota automáticamente.
3. `PUT /api/installments/:id` — actualizar cuota_actual.
4. `DELETE /api/installments/:id` — borrar.
5. `GET /api/installments/commitments?months=6&start=2026-04` — proyección de cuánto se paga en cuotas cada mes futuro.

### Upload
1. `POST /api/upload` — recibe archivo (multipart/form-data). Body fields: `file`, `account_id`, `period` (YYYY-MM). Proceso:
   a. Guardar archivo en `uploads/`.
   b. Si es PDF, extraer texto con pdf-parse. Si es imagen, guardar referencia (el parsing manual se hace después desde la UI).
   c. Intentar extraer transacciones del texto con regex (ver sección Parsing).
   d. Para cada transacción extraída, calcular `dedup_hash` y verificar que no exista. Solo insertar las nuevas.
   e. Aplicar reglas de auto-categorización a las transacciones nuevas.
   f. Devolver: `{ upload_id, new_transactions: N, duplicates_skipped: N, auto_categorized: N, pending_review: N }`.

### Settings
1. `GET /api/settings` — todas las settings como objeto `{ key: value }`.
2. `PUT /api/settings` — actualizar. Body: `{ key, value }`.

### Export
1. `GET /api/export/csv?month=2026-03` — devuelve archivo CSV. Columnas: `fecha,descripcion_banco,descripcion_usuario,monto,moneda,categoria,cuenta,tipo_gasto,es_cuota`. Content-Type: text/csv. Content-Disposition: attachment.

### Savings / Insights
1. `GET /api/savings/projection?months=12` — proyección de ahorro basada en: ahorro mensual promedio de los últimos 6 meses menos compromiso de cuotas futuras. Devuelve serie temporal con ahorro real histórico y proyección.
2. `GET /api/insights?month=2026-03` — insights calculados dinámicamente:
   a. Categoría que más creció vs. mes anterior (nombre, delta porcentual, montos).
   b. Gasto promedio diario del mes.
   c. Días restantes del mes y presupuesto disponible por día.
   d. ETA al objetivo de ahorro (en meses) descontando cuotas.

## Lógica de parsing de PDFs

Los PDFs de bancos uruguayos no tienen formato estándar. El approach es:

1. Extraer todo el texto del PDF como string con `pdf-parse`.
2. Splitear en líneas.
3. Aplicar regex para detectar líneas que parecen transacciones. El patrón genérico busca: una fecha (dd/mm, dd/mm/yyyy, o variantes), seguida de texto (descripción), seguida de un monto (con punto o coma como separador de miles/decimales).
4. El extractor debe ser configurable. Guardar los patrones regex como configuración editable, no hardcodeados.

Regex base sugerido para líneas de transacción:
```javascript
// Fecha al inicio + texto + monto al final
/^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([\-]?\$?\s?[\d.,]+(?:\.\d{2})?)\s*$/
```

El extractor devuelve un array de `{ fecha, desc_banco, monto }`. Las transacciones que no matchean ningún patrón se loguean para debug pero no se insertan.

Para screenshots/imágenes: no hacer OCR en esta versión. El upload de imagen guarda la referencia y el usuario carga las transacciones manualmente desde la UI (formulario de carga manual de transacción).

## Lógica de deduplicación

Al insertar transacciones desde un upload:

1. Calcular hash: `sha256(fecha + "|" + monto + "|" + normalizar(desc_banco))` donde normalizar = lowercase, trim, eliminar espacios múltiples.
2. Verificar si ya existe una transacción con ese `dedup_hash` en el mismo `period`.
3. Si existe, skip. Si no, insertar.

Esto permite subir el resumen completo del mes varias veces o subir parciales y que se mergeen correctamente.

## Lógica de auto-categorización

Cuando entra una transacción nueva:

1. Recorrer todas las reglas ordenadas por `match_count` descendente (las más usadas primero).
2. Para cada regla, hacer `desc_banco.toLowerCase().includes(pattern.toLowerCase())`.
3. Si matchea, asignar `category_id` de la regla e incrementar `match_count`.
4. Si no matchea ninguna regla, dejar `category_id` como NULL (pendiente de review).

Cuando el usuario categoriza una transacción manualmente:

1. Actualizar la transacción con la categoría.
2. Buscar si ya existe una regla con un patrón contenido en `desc_banco`.
3. Si no existe, crear una regla nueva con: `pattern` = la parte más significativa de `desc_banco` (las primeras dos palabras, sin números de referencia). Si el usuario puede editar el patrón antes de confirmar, mejor.
4. Si ya existe pero con categoría diferente, no sobreescribir. Notificar al usuario del conflicto.

## Frontend: páginas y comportamiento

### Dashboard (tab principal)
Componentes visibles:
1. **Selector de período** en el header: flechas izquierda/derecha para navegar mes a mes. Formato: "Mar 2026". Todos los datos del dashboard se filtran por este período.
2. **Metric cards** (fila superior, 4 cards):
   a. Patrimonio total en la moneda de display (configurable UYU/USD). Conversión usa el tipo de cambio de settings.
   b. Ingresos del mes + delta porcentual vs. mes anterior.
   c. Gastos del mes + delta porcentual vs. mes anterior.
   d. Margen disponible (ingresos menos gastos fijos menos gastos variables). Color verde si positivo, rojo si negativo.
3. **Fila de fijos/variables/cuotas** (3 cards):
   a. Total gastos fijos del mes.
   b. Total gastos variables del mes.
   c. Total cuotas comprometidas del mes.
4. **Controles**: selector de moneda de display, input de tipo de cambio, botón exportar CSV.
5. **Donut chart** de gastos por categoría con leyenda y porcentajes.
6. **Bar chart** de evolución mensual (ingresos vs gastos, últimos 6 meses).
7. **Barras de presupuesto** por categoría: barra de progreso que muestra gastado vs presupuesto. Indicador visual amarillo al superar 80%, rojo al superar 100%. Mostrar el tipo (fijo/variable) al lado del nombre.
8. **Tabla de transacciones** del mes: columnas fecha, descripción banco, monto, cuenta, categoría. Las transacciones sin categorizar tienen fondo ámbar y un selector de categoría inline. Las de cuotas se marcan con un badge.

### Cargar PDF (tab Upload)
1. Zona de drag-and-drop para archivo (PDF o imagen).
2. **Selector de cuenta de origen**: dropdown con las cuentas del usuario. Obligatorio antes de subir.
3. Selector de período si no se detecta automáticamente.
4. Al subir, mostrar resultado: N transacciones nuevas, N duplicados salteados, N auto-categorizadas, N pendientes de review.
5. **Formulario de carga manual** de transacción: para cuando el usuario quiere ingresar algo a mano (screenshot que no se puede parsear, gasto en efectivo, etc.). Campos: fecha, descripción, monto, moneda, cuenta.
6. **Historial de uploads** del período: lista de archivos subidos con fecha, cuenta, cantidad de transacciones, status.

### Ahorro (tab Savings)
1. Inputs editables: capital inicial, objetivo, moneda de la proyección.
2. **Metric cards**: ahorro mensual promedio (últimos 6 meses), cuotas mensuales, ahorro neto (sin cuotas).
3. **Gráfico de área**: ahorro real acumulado (histórico) + proyección futura (línea punteada) + línea de objetivo. La proyección descuenta el compromiso de cuotas futuras de cada mes.
4. **Gráfico de barras**: compromiso en cuotas para los próximos 6 meses.
5. **Insights dinámicos** (bloque azul claro): textos calculados a partir de los datos reales, no hardcodeados. Incluir:
   a. Categoría que más creció vs. mes anterior (nombre, porcentaje, montos).
   b. Gasto promedio diario del mes actual.
   c. Días restantes del mes y presupuesto restante con ritmo disponible por día.
   d. ETA al objetivo de ahorro recalculada descontando deuda en cuotas.

### Cuentas (tab Accounts)
1. **Patrimonio total** en UYU (card resumen).
2. **Input de tipo de cambio** editable.
3. **Tabla de cuentas**: nombre, moneda, balance, equivalente en UYU. Cada balance es editable inline.
4. **Formulario para agregar cuenta**: nombre, moneda (UYU/USD/ARS), balance inicial.

### Cuotas (tab Installments)
1. **Metric cards**: total cuotas este mes, deuda total restante.
2. **Tabla de cuotas activas**: descripción, monto total, cuota actual/total, monto por mes, cuenta, botón borrar.
3. **Formulario para agregar**: descripción, monto total, cantidad de cuotas, cuenta. El monto por cuota se calcula automáticamente.

### Reglas (tab Rules)
1. **Configuración de presupuestos**: lista de categorías con inputs para presupuesto mensual y toggle fijo/variable. Editable inline.
2. **Tabla de reglas de categorización**: patrón, categoría asignada, cantidad de matches, botón borrar.
3. **Formulario para agregar regla manual**: input de patrón, selector de categoría, botón agregar.

## Paleta de colores del frontend

Usar estas variables de color consistentemente en todo el frontend. Definir en Tailwind config como colores custom si es necesario.

```
Categorías:
  Supermercado:   #534AB7 (fondo: #EEEDFE)
  Transporte:     #1D9E75 (fondo: #E1F5EE)
  Suscripciones:  #D85A30 (fondo: #FAECE7)
  Restaurantes:   #378ADD (fondo: #E6F1FB)
  Servicios:      #BA7517 (fondo: #FAEEDA)
  Alquiler:       #639922 (fondo: #EAF3DE)
  Salud:          #E24B4A (fondo: #FCEBEB)
  Otros:          #888780 (fondo: #F1EFE8)
  Ingreso:        #639922 (fondo: #EAF3DE)

Semánticos:
  Positivo/ahorro: #1D9E75
  Negativo/gasto:  #E24B4A
  Warning (80%+):  #BA7517
  Info/proyección:  #378ADD
```

## Formato de moneda

Función `fmtMoney(amount, currency)`:
1. UYU: `$48.320` (signo pesos, punto como separador de miles).
2. USD: `US$1.240`.
3. ARS: `AR$150.000`.
4. Los montos negativos llevan el signo antes: `-$2.340`.
5. Siempre redondear a enteros para display (sin decimales a menos que sea USD con centavos).

## Datos de ejemplo (seed)

Al inicializar la base, insertar datos de ejemplo realistas en pesos uruguayos para que la app funcione desde el primer arranque. Incluir al menos:

1. 4 cuentas: BROU Caja de Ahorro (UYU), Visa Gold BROU (UYU, balance negativo), BROU USD (USD), Itaú Cuenta Corriente (UYU).
2. 8 categorías: Alquiler (fijo, $18.000), Supermercado (variable, $12.000), Transporte (variable, $6.000), Suscripciones (fijo, $5.000), Restaurantes (variable, $8.000), Servicios (fijo, $7.000), Salud (variable, $4.000), Otros (variable, $5.000).
3. 20+ transacciones de marzo 2026 y 10+ de febrero 2026 (para comparación). Incluir ingresos (sueldo), gastos fijos (alquiler, servicios, suscripciones), gastos variables (supermercado, restaurantes, transporte), y pagos de cuotas.
4. 3 compras en cuotas activas.
5. 10 reglas de categorización pre-cargadas.
6. Settings iniciales: TC USD/UYU = 42.5, moneda display = UYU, capital ahorro = 50.000, objetivo = 200.000.

## Scripts de arranque

El `package.json` raíz debe tener:
```json
{
  "scripts": {
    "dev": "concurrently \"npm run server\" \"npm run client\"",
    "server": "cd server && node index.js",
    "client": "cd client && npm run dev",
    "setup": "cd server && npm install && cd ../client && npm install",
    "seed": "cd server && node seed.js"
  }
}
```

Al correr `npm run setup` se instalan todas las dependencias. Al correr `npm run seed` se inicializa la base con datos de ejemplo (solo si está vacía, no sobreescribir). Al correr `npm run dev` se levantan server (puerto 3001) y client (Vite en puerto 5173) simultáneamente.

## Instrucciones para Claude Code

1. Empezar por el backend: crear la base de datos, migraciones, y seed. Verificar que los endpoints devuelven datos correctos antes de pasar al frontend.
2. Testear cada endpoint con requests manuales (curl o similar) durante el desarrollo.
3. El frontend consume todo via `/api/*`. Configurar proxy en Vite para redirigir al backend.
4. No usar TypeScript. JavaScript puro en todo el proyecto.
5. No usar ORMs. Queries SQL directas con `better-sqlite3`. Las queries preparadas son suficientes para prevenir SQL injection.
6. El CSS es Tailwind utility-first. No crear archivos CSS custom salvo el import de Tailwind en `index.css`.
7. Para Recharts: usar ResponsiveContainer siempre. No hardcodear dimensiones de gráficos.
8. Los componentes React deben ser funcionales con hooks. No usar class components.
9. Manejar estados de loading y error en cada página que hace fetch.
10. El servidor debe crear la base de datos y correr migraciones automáticamente al arrancar si el archivo `.db` no existe.

## Prioridad de implementación

Fase 1 (core funcional):
1. Base de datos + migraciones + seed.
2. Endpoints de transactions, categories, accounts, settings.
3. Dashboard con metric cards, donut, barras, tabla de transacciones, selector de período.
4. Categorización manual desde la tabla con creación automática de reglas.

Fase 2 (upload + auto-categorización):
1. Endpoint de upload con PDF parsing.
2. Deduplicación.
3. Auto-categorización por reglas.
4. UI de upload con selector de cuenta y carga manual.

Fase 3 (features avanzadas):
1. Presupuestos por categoría con barras de progreso.
2. Fijos vs variables.
3. Cuotas y deuda (installments).
4. Calculadora de ahorro con proyección.
5. Insights dinámicos.
6. Tipo de cambio y patrimonio unificado.
7. Exportación CSV.

## Errores comunes a evitar

1. No guardar el archivo `.db` en git. Agregar `*.db` al `.gitignore`.
2. No usar `localStorage` en el frontend para datos persistentes. Todo va a la API.
3. No hardcodear el mes actual. Siempre usar el selector de período.
4. No asumir que el PDF va a tener formato específico. El parser debe ser tolerante a errores y loguear lo que no puede parsear.
5. Al crear reglas automáticamente desde la categorización manual, limpiar números de referencia y asteriscos del patrón. Ejemplo: "PEDIDOSYA *7732" debería generar regla con patrón "PEDIDOSYA" (sin el código variable).
6. El dedup_hash debe normalizarse: lowercase, trim, eliminar espacios múltiples, antes de hashear.
7. Los montos en los PDFs pueden venir con coma como decimal y punto como miles (formato uruguayo). El parser debe manejar ambos formatos.
