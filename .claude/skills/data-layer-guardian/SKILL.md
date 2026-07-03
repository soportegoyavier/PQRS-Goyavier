---
description: Aplica esta skill cuando se lea, escriba o modifique el esquema de datos de PQRS-Goyavier — cualquier cambio a getHeaders(), a las pestañas de Google Sheets (PQRS, Seguimientos, Configuracion, UsuariosPQRS, Respuestas de formulario 1), a syncData()/getData(), o a cualquier fetch de escritura hacia el backend — porque este proyecto usa Google Sheets como base de datos, NO Supabase/Postgres, y tiene semántica de clear-and-rewrite sin locking.
when_to_use: ["vamos a agregar una columna a PQRS", "necesito leer/escribir en Sheets", "hay un riesgo de que se pisen dos ediciones", "cómo se guarda la configuración", "voy a agregar un campo nuevo a la solicitud", "esto necesita una migración de esquema"]
paths: "CODE-APPS-SCRIPT-FINAL.gs, PQRS-FINAL.html"
---

## Descripción

**Este proyecto NO usa Supabase, NO usa Postgres, NO tiene RLS, NO tiene un ORM.** La capa de datos completa de PQRS-Goyavier son 5 pestañas de una hoja de Google Sheets, leídas y escritas desde Google Apps Script. Esta skill reemplaza lo que en otro proyecto sería una "skill de Supabase" — aquí no aplica tal cual, así que se adapta al modelo real: Sheets como base de datos, con sus propias garantías (pocas) y sus propios riesgos (concurrencia, ausencia de transacciones, ausencia de tipos).

## Objetivo

Que cualquier cambio de esquema o de patrón de lectura/escritura respete el modelo real de datos: `getHeaders()` como fuente de verdad del esquema de `PQRS`, el patrón clave/valor JSON-stringificado de `Configuracion`, y sobre todo la semántica de **clear-and-rewrite completo sin upsert ni locking** de `syncData()` — que es la fuente de mayor riesgo de pérdida de datos por escritura concurrente en todo el sistema.

## Cuándo debe utilizarse

- Antes de agregar, quitar o renombrar una columna en la pestaña `PQRS` (o en cualquier otra pestaña).
- Antes de modificar `getHeaders()`, `ensureHeaders()`, `getData()` o `syncData()` en `CODE-APPS-SCRIPT-FINAL.gs`.
- Antes de agregar una clave nueva a `Configuracion`.
- Antes de agregar un `fetch` de escritura nuevo hacia el backend.
- Cuando se discuta cualquier riesgo de "se perdió un cambio", "dos personas guardaron al mismo tiempo", "el dato no llegó a Sheets".

## Instrucciones detalladas

### 1. Las "tablas" son pestañas de Google Sheets — mapa completo

Constantes en `CODE-APPS-SCRIPT-FINAL.gs:11-15`:

| Constante | Nombre real de la pestaña | Propósito |
|---|---|---|
| `SHEET_NAME` | `PQRS` | Registros principales de solicitudes. |
| `FORMS_SHEET` | `Respuestas de formulario 1` | Envíos crudos del Google Form (ingesta), con columnas `FormsID`/`Revisado` añadidas por la app. |
| `SEG_SHEET` | `Seguimientos` | Línea de tiempo — una fila por evento. |
| `CFG_SHEET` | `Configuracion` | Clave/valor de configuración. |
| `USUARIOS_SHEET` | `UsuariosPQRS` | Cuentas de staff autorizado. |

### 2. `getHeaders()` es la fuente de verdad del esquema de `PQRS`

`CODE-APPS-SCRIPT-FINAL.gs:1316-1321`:

```js
function getHeaders() {
  return ['ID','Fecha','Dependencia','Nombre',
    'Telefono','Correo','Estudiante','Grado','TipoSolicitud','MedioRecepcion',
    'RequiereRespuesta','Descripcion','Estado','EmailPendiente','CreadoEn','OrigenForms',
    'ObservacionSolicitante','FechaObservacion','FormsKey'];
}
```

Más una columna `TokenRespuesta` que se añade dinámicamente en tiempo de ejecución vía `_actualizarTokenRespuesta_` (líneas 395-416) — no está en el arreglo estático de `getHeaders()`, así que cualquier código que asuma que `getHeaders()` es exhaustivo se equivoca; hay que verificar también la existencia de esta columna dinámica.

**Regla operativa**: cualquier campo nuevo en una solicitud PQRS debe agregarse a este arreglo (respetando el orden si el código en otras partes accede por índice posicional, no solo por nombre), y debe verificarse en TODOS estos lugares a la vez:
- `getHeaders()` / `ensureHeaders()` en el `.gs` (esquema real).
- `getData()` (líneas 194-318) — construcción del objeto de solicitud a partir de la fila.
- `syncData()` (líneas 347-391) — reescritura de la fila a partir del objeto.
- El objeto de solicitud correspondiente en el cliente (`PQRS-FINAL.html`) — cualquier `render*`, `abrirEnvio`, formularios de captura.
- La copia embebida `APPS_SCRIPT_CODE` (ver skill `regression-guardian`) si `getHeaders()`/`ensureHeaders()`/`getData()`/`syncData()` se tocan.

### 3. `syncData()` hace clear-and-rewrite completo — NO hay upsert ni locking

`CODE-APPS-SCRIPT-FINAL.gs:347-391`. Cada vez que el cliente empuja datos (`pushToSheets()`, `PQRS-FINAL.html:1546`), el servidor:

1. Toma el arreglo completo de solicitudes (o seguimientos) recibido.
2. Llama `clearContent()` sobre el rango de datos de la pestaña completa.
3. Reescribe TODAS las filas desde cero a partir del arreglo recibido.

Esto significa: **no existe la noción de "actualizar solo la fila que cambió"**. Cada push es un reemplazo total del dataset de esa pestaña. No hay `LockService` (`LockService.getScriptLock()`), no hay control de concurrencia optimista real, no hay versión/timestamp comparado antes de sobrescribir.

**Consecuencia de riesgo real**: hay un `pullFromSheets(false)` corriendo en `setInterval` cada 120 segundos (`PQRS-FINAL.html:1533`). Si dos sesiones de staff tienen la pestaña abierta y ambas modifican datos casi simultáneamente, es posible que:
- Sesión A cargue el dataset completo (pull).
- Sesión B modifique una solicitud y haga push (clear + rewrite completo con SU snapshot, que no incluye lo que A está por hacer).
- Sesión A modifique otra solicitud (basada en su snapshot desactualizado) y haga push — sobrescribiendo el cambio de B, porque A nunca vio el cambio de B antes de escribir.

La única mitigación existente hoy es una heurística ad hoc en `replaceWithRemote()` (`PQRS-FINAL.html:2973-3034`), que intenta reconciliar el estado remoto con el local de forma best-effort — no es una solución de concurrencia real, es un parche.

**Regla operativa**: cualquier cambio nuevo a `syncData()` o a la lógica de push/pull debe:
1. Reconocer explícitamente esta limitación en cualquier discusión de diseño — no asumir que "ya hay sincronización" resuelve la concurrencia.
2. Si se va a mejorar esto, considerar opciones reales: `LockService.getScriptLock()` alrededor de la sección crítica de `syncData()`, un upsert real por fila (comparar por `ID`/`PQRS_ID` en vez de clear-and-rewrite), o reducir el intervalo de polling combinado con detección de conflicto por timestamp (`CreadoEn`/`RegistradoEn`). Cualquiera de estas es un cambio de diseño no trivial — no improvisar una versión parcial sin plan.
3. Nunca "arreglar" un síntoma de este problema (ej. "a veces se pierden seguimientos") con un retry silencioso sin entender que la causa raíz es la ausencia de locking.

### 4. `Configuracion` es clave/valor con JSON stringificado

`readConfigObject_()` (líneas 160-171) lee la pestaña `Configuracion` como pares clave/valor donde el valor es una cadena JSON. Claves conocidas: `diasRespuesta` (número, default 15 días hábiles), `alertaDias` (número, default 2), `emailAreas` (objeto mapa dependencia→correo), `dependencias` (arreglo de 12 strings).

**Regla operativa**: cualquier clave de configuración nueva debe:
- Serializarse con `JSON.stringify()` al escribir y parsearse con `JSON.parse()` al leer, igual que las existentes — no inventar un formato de serialización distinto (ej. CSV manual) para una clave nueva.
- Tener un valor por defecto razonable manejado en el código (como `diasRespuesta` default 15, `alertaDias` default 2), para que la ausencia de la clave en la hoja no rompa el sistema.
- Documentarse en el mismo lugar donde viven las demás (cerca de `readConfigObject_`), no dispersarse.

### 5. Riesgo de `Seguimientos` y relaciones por coincidencia de strings

`Seguimientos.PQRS_ID` no es una foreign key real — es una comparación lineal de strings contra `PQRS.ID` dentro de `getData()` (líneas 194-318). No hay índice, no hay integridad referencial garantizada por la plataforma. Si se genera un `PQRS_ID` con un typo, un espacio extra, o un formato distinto (ver skill `regression-guardian` sobre el literal `PQRS2260`), el seguimiento queda huérfano silenciosamente — no habrá error, simplemente no aparecerá en la línea de tiempo de ninguna solicitud.

**Regla operativa**: cualquier código nuevo que escriba un `PQRS_ID` en `Seguimientos` debe usar el mismo valor exacto de `ID` ya existente en `PQRS` (nunca reconstruirlo o reformatearlo), y cualquier cambio al formato del ID debe revisarse contra este acoplamiento.

### 6. El `mode:'no-cors'` en las escrituras

Ver skill `regression-guardian` para el detalle completo, pero es relevante aquí también: como la capa de datos se escribe vía HTTP con `fetch(url, {method:'POST', mode:'no-cors'})` (`PQRS-FINAL.html:1546`, `:2818`), cualquier fallo de escritura en el backend (token inválido, excepción, cuota de Apps Script excedida) es indistinguible de un éxito desde la perspectiva del cliente. Esto agrava el riesgo de concurrencia del punto 3: si un push "falla" silenciosamente, el cliente cree que sus datos ya están en Sheets cuando en realidad no lo están, y el próximo `pullFromSheets()` puede "revertir" cambios que el usuario cree que ya guardó.

## Reglas obligatorias

1. Todo campo nuevo en `PQRS` debe agregarse consistentemente en `getHeaders()`, `getData()`, `syncData()`, el cliente, y (si aplica) la copia embebida `APPS_SCRIPT_CODE`.
2. Nunca asumir que `syncData()` hace un upsert por fila — es clear-and-rewrite completo; cualquier cambio a esta función debe preservar (o mejorar deliberadamente, con diseño explícito) esa semántica.
3. Cualquier discusión sobre pérdida de datos o "se pisaron cambios" debe considerar la ausencia de locking en `syncData()` y el polling de 120s como causa raíz probable, no como un bug aislado a parchear con retries.
4. Toda clave nueva en `Configuracion` debe usar JSON stringificado como las existentes y tener un valor por defecto manejado en código.
5. Nunca reformatear o reconstruir un `PQRS.ID` al escribir `Seguimientos.PQRS_ID` — debe ser el mismo valor exacto para no romper la relación por coincidencia de string.
6. Cualquier escritura nueva hacia el backend con `mode:'no-cors'` debe documentarse como potencialmente silenciosa en caso de fallo (ver `regression-guardian`).

## Criterios de validación

- ¿Se agregó/quitó/renombró una columna en `PQRS`? Si sí, ¿se verificó consistencia en los 4-5 lugares listados en el punto 2?
- ¿Se tocó `syncData()`? Si sí, ¿se preservó la semántica de clear-and-rewrite o se propuso explícitamente un cambio de diseño (locking, upsert) en vez de una mejora parcial improvisada?
- ¿Se agregó una clave nueva a `Configuracion`? Si sí, ¿usa JSON stringificado y tiene default en código?
- ¿Se escribe `Seguimientos.PQRS_ID` en algún código nuevo? Si sí, ¿se usa el mismo string exacto que `PQRS.ID` sin reformatear?
- ¿Se discutió un caso de "pérdida de datos" o "conflicto de edición"? Si sí, ¿se consideró la ausencia de locking en `syncData()` como causa raíz antes de proponer un parche superficial?

## Checklist final

- [ ] Cambios de esquema en `PQRS` están sincronizados entre `getHeaders()`, `getData()`, `syncData()`, cliente y copia embebida.
- [ ] `syncData()` sigue siendo (o se cambió deliberadamente, con diseño explícito) clear-and-rewrite sin locking — no hay un upsert parcial improvisado a medias.
- [ ] Claves nuevas de `Configuracion` usan JSON stringificado y tienen valor por defecto.
- [ ] Ningún código nuevo reformatea `PQRS.ID` al escribir `Seguimientos.PQRS_ID`.
- [ ] Escrituras nuevas con `mode:'no-cors'` están documentadas como potencialmente silenciosas en caso de fallo.
- [ ] Ninguna sugerencia de este cambio asumió Postgres/Supabase/SQL — todo el razonamiento se hizo en términos de Sheets real.
