---
description: Aplica esta skill al comienzo de cualquier tarea sobre el repositorio PQRS-Goyavier para fijar los hechos de identidad del proyecto que no deben asumirse incorrectamente — backend real es Google Apps Script + Google Sheets (NO Supabase/Postgres), los 2 archivos fuente deben mantenerse sincronizados, entidades PQRSF con campos propios del colegio, rol único Staff, ciudadanos sin login propio.
when_to_use: ["¿qué stack usa este proyecto?", "voy a empezar a trabajar en PQRS-Goyavier", "necesito entender la arquitectura general antes de un cambio", "asumamos que hay una base de datos Postgres/Supabase aquí", "¿qué campos tiene una solicitud?"]
paths: "CODE-APPS-SCRIPT-FINAL.gs, PQRS-FINAL.html, logo_goyavier.png"
---

## ⚠ Actualización 2026-11-19 — perfiles y bandejas (prevalece sobre lo que se dice más abajo)

- **Ya no existe el rol único `'Staff'`.** Cada usuario de `UsuariosPQRS` tiene un **Perfil** (`Secretaria`, `Talento Humano`, `Rectoria`). Cada solicitud cae en una **bandeja** según quién la presenta (columna `TipoSolicitante`: Padre de familia / Estudiante → `secretaria`; Colaborador / Proveedor o contratista / Visitante → `talento`). Secretaría ve solo su bandeja, Talento Humano solo la suya y Rectoría todo. El filtro se aplica **en el servidor** (`getData`, `syncData`, `enviarObsArea_`), nunca solo en la interfaz.
- Solo «Padre de familia» y «Estudiante» llevan `Estudiante` y `Grado`. «Colaborador» como grado es un dato del formulario viejo: se normaliza a tipo Colaborador.
- **El desfase entre `.gs` y `APPS_SCRIPT_CODE` se resuelve con una herramienta**: la copia embebida se genera con `python sincronizar_script_embebido.py` (el `.gs` es la única fuente). Nunca editarla a mano.
- Las hojas se leen y escriben **por nombre de columna**, no por posición (`ensureHeaders` solo agrega columnas al final).
- Las pruebas automáticas están en `pruebas/` (ver su README).

## Descripción

Esta es la skill de identidad general del proyecto PQRS-Goyavier — el ancla que evita que cualquier razonamiento futuro (de Claude o de quien lea el repo) asuma incorrectamente un stack, una arquitectura de datos, o un modelo de permisos que no corresponden a la realidad del código. Complementa (no reemplaza) a las otras 6 skills especializadas: `architecture-guardian`, `regression-guardian`, `data-layer-guardian`, `ui-guardian`, `security-guardian`, `business-logic-guardian`.

## Objetivo

Fijar, de forma citable y verificable contra el código real, los hechos fundamentales del proyecto: qué es, qué stack usa (y qué NO usa), cómo se despliega, cuáles son sus entidades de dominio, y cuáles son sus límites de permisos y autenticación — para que ninguna sugerencia futura parta de una premisa equivocada (como "agreguemos una tabla en Supabase" o "démosle un rol de admin a este usuario").

## Cuándo debe utilizarse

- Al iniciar cualquier tarea nueva sobre este repositorio, como marco de referencia general.
- Cuando se proponga o se asuma cualquier tecnología de backend distinta a Google Apps Script (Supabase, Postgres, Firebase, Node/Express, etc.) — para corregir la premisa antes de continuar.
- Cuando se necesite recordar la lista real de dependencias organizacionales (`Dependencia`) o los campos propios del dominio (`Estudiante`, `Grado`).
- Cuando se discuta el modelo de permisos/roles o el acceso de los ciudadanos/solicitantes.
- Como referencia rápida antes de delegar a una de las 6 skills especializadas más específicas.

## Instrucciones detalladas

### 1. Qué es este proyecto

Sistema PQRSF (Petición/Queja/Reclamo/Felicitación/Sugerencia) de intake y seguimiento para la Secretaría Académica del Colegio Goyavier Campestre (Colombia). El repositorio completo son 3 archivos:

- `PQRS-FINAL.html` — 4178 líneas, ~476KB — el cliente completo (HTML+CSS+JS en un solo archivo).
- `CODE-APPS-SCRIPT-FINAL.gs` — 1429 líneas, ~79KB — el backend real de Google Apps Script.
- `logo_goyavier.png` — el logo del colegio (nótese: existe una SEGUNDA copia como data-URI base64 de 275,399 caracteres en `PQRS-FINAL.html:657` — ver duplicaciones a vigilar más abajo).

No hay `package.json`, no hay `README`, no hay `docs/`, no hay build, no hay npm.

### 2. El stack real — Google Apps Script + Google Sheets, NO Supabase

**Este proyecto NUNCA ha usado Supabase, Postgres, ni ningún otro backend gestionado.** Se despliega vía `HtmlService.createHtmlOutputFromFile('PQRS-FINAL')` dentro de `doGet(e)` (`CODE-APPS-SCRIPT-FINAL.gs:102`) y recibe escrituras vía `doPost(e)` (línea 138). La "base de datos" son 5 pestañas de una hoja de Google Sheets — ver skill `data-layer-guardian` para el detalle completo del esquema (`getHeaders()`, `syncData()`, patrón de `Configuracion`).

Si en algún momento se plantea "migrar a Supabase" (como se hizo en otros proyectos del mismo autor, ej. Manto), eso sería un cambio de arquitectura mayúsculo — equivalente a reescribir el proyecto desde cero — y debe tratarse como tal: nunca asumir que ya está en camino, nunca mezclar código de Supabase/SQL en este repo sin que sea una decisión explícita y confirmada.

### 3. Los 2 archivos deben mantenerse sincronizados — el caso de drift ya real

`PQRS-FINAL.html` contiene una segunda copia completa del backend embebida como template literal (`const APPS_SCRIPT_CODE`, línea 3039), presentada a través del botón "📋 Ver Script de Apps Script" como la vía OFICIAL de despliegue documentada dentro de la propia Configuración de la app. Esa copia (60,381 caracteres, 29 funciones) ya está desactualizada respecto al `.gs` real (78,854 caracteres, 33 funciones) — le faltan 4 funciones reales: `login_`, `enviarObsArea_`, `_actualizarTokenRespuesta_`, e `inicializarSistema()` (la más crítica: sin ella un despliegue desde cero no puede ni inicializar las pestañas ni sembrar los usuarios de staff).

Este es el caso de estudio obligatorio a citar para cualquier discusión sobre sincronización entre archivos — ver el detalle completo, con tabla de funciones faltantes y consecuencias, en la skill `regression-guardian`. Cualquier cambio a `CODE-APPS-SCRIPT-FINAL.gs` debe evaluarse contra esa copia embebida antes de considerarse terminado.

### 4. Entidades del dominio PQRSF — campos propios del colegio

Una solicitud (pestaña `PQRS`) no es un ticket genérico de soporte — tiene campos específicos del contexto escolar, definidos en `getHeaders()` (`.gs:1316-1321`):

```
ID, Fecha, Dependencia, Nombre, Telefono, Correo, Estudiante, Grado,
TipoSolicitud, MedioRecepcion, RequiereRespuesta, Descripcion, Estado,
EmailPendiente, CreadoEn, OrigenForms, ObservacionSolicitante,
FechaObservacion, FormsKey
```

Nótese en particular `Estudiante` y `Grado` — la solicitud está vinculada a un estudiante matriculado, no solo a un "cliente" genérico. `TipoSolicitud` es el enum PQRSF (Petición/Queja/Reclamo/Felicitación/Sugerencia), representado con `badgeHtml()` (línea 1877).

`Dependencia` es una de las 12 áreas organizacionales reales del colegio (definidas en `Configuracion.dependencias`, con default sembrado por `inicializarSistema()`, `.gs:1391-1395`):

```
Coord. Preescolar, Coord. Academica, Bachillerato, Mantenimiento,
Servicio de restaurante, Coord. Primaria, Coord. Convivencia,
Secretaria, Servicios Varios, Biblioteca, Sistemas, Enfermeria
```

Esta lista es configurable desde la UI (Configuración → Dependencias), pero cualquier lógica que asuma un conjunto FIJO y hardcodeado de dependencias distinto a este (o que ignore que es configurable y por tanto puede crecer/cambiar) es un error de diseño.

### 5. Modelo de acceso — un único rol, ciudadanos sin login propio

- **Staff**: se autentica vía Google OAuth (`googleLogin_`, validando contra `UsuariosPQRS`) o usuario/contraseña legacy (`login_`, comparación en texto plano). Ambas rutas emiten el mismo tipo de token de sesión (UUID en `CacheService.getScriptCache()`, TTL 6 horas) y ambas hardcodean **el mismo y único rol: `'Staff'`** — no hay admin/agente/lectura-solamente. Ver skill `security-guardian` para las implicaciones de seguridad de esto.
- **Ciudadanos/solicitantes**: NUNCA inician sesión en el sistema. Interactúan exclusivamente vía enlaces de un solo uso enviados por correo — el enlace de respuesta del solicitante (`?action=responder&id=...&tkn=...`, con token real de un solo uso) para cerrar o apelar su solicitud.
- **Áreas/dependencias**: tampoco inician sesión — reciben un enlace de respuesta de área (`?action=responderArea&id=...&area=...`) que hoy NO tiene token real, solo un ID predecible — brecha de seguridad conocida, ver `security-guardian`.

### 6. Flujo completo del ciclo de vida de una solicitud

1. Ciudadano llena el Google Form → trigger `onFormSubmit(e)` (`.gs:19-100`) crea una fila en estado `Borrador` y notifica a Secretaría.
2. Staff revisa en Bandeja de Entrada, asigna `Dependencia`, llama `enviarSolicitud(sendNow)` (`PQRS-FINAL.html:2293-2366`) — envía ya (estado → `Proceso`) o difiere a Correos Pendientes (estado → `Abierto`).
3. El área responde vía el enlace público (sin token, ver arriba), queda pendiente de aprobación por Secretaría antes de relayar al ciudadano.
4. El ciudadano recibe su enlace de un solo uso para cerrar (`Cerrado`) o apelar (`Apelado`).
5. Toda la línea de tiempo se reconstruye client-side en `buildTimeline(sol)` (líneas 1898-1954). Ver detalle completo de la máquina de estados y SLA en `business-logic-guardian`.

### 7. Otras duplicaciones a vigilar (además del `.gs`/`APPS_SCRIPT_CODE`)

- El logo existe 2 veces: `logo_goyavier.png` y un data-URI base64 de una sola línea (275,399 caracteres) en `PQRS-FINAL.html:657`. No agregar una tercera copia si se necesita el logo en otro contexto — reutilizar una de las dos existentes.
- La barra de filtros (buscador + mes + fecha desde/hasta + Limpiar) está triplicada para Seguimiento/Correos/Historial — ver `architecture-guardian` y `ui-guardian` para la regla de no crear una 4ª copia.

## Reglas obligatorias

1. Nunca asumir, sugerir, ni introducir Supabase/Postgres/Firebase/cualquier backend gestionado en este proyecto — el backend real y único es Google Apps Script + Google Sheets.
2. Cualquier cambio al `.gs` real debe evaluarse contra la copia embebida `APPS_SCRIPT_CODE` en `PQRS-FINAL.html` (ver `regression-guardian`).
3. Los campos de dominio (`Estudiante`, `Grado`, `Dependencia`, `TipoSolicitud`) deben tratarse como específicos del contexto escolar — no genéricos de un sistema de tickets cualquiera.
4. La lista de `Dependencia` es configurable desde `Configuracion.dependencias` — no hardcodear una lista distinta ni asumir que es fija.
5. No asumir la existencia de roles/permisos distintos a `'Staff'` — hoy es el único rol (ver `security-guardian`).
6. No asumir que los ciudadanos o las áreas tienen cuentas o sesiones — su único mecanismo de interacción son enlaces de un solo uso por correo.
7. No introducir una 3ª copia del logo ni una 4ª copia de la barra de filtros.

## Criterios de validación

- ¿Alguna sugerencia de esta tarea asume o introduce Supabase/Postgres/otro backend gestionado? Si sí, corregir la premisa antes de continuar.
- ¿Se tocó `CODE-APPS-SCRIPT-FINAL.gs`? Si sí, ¿se evaluó el impacto en la copia embebida `APPS_SCRIPT_CODE`?
- ¿Se trató algún campo de dominio (`Estudiante`, `Grado`, `Dependencia`) como genérico en vez de específico del contexto escolar?
- ¿Se hardcodeó una lista de dependencias distinta a la configurable en `Configuracion.dependencias`?
- ¿Se asumió un rol distinto a `'Staff'`, o que los ciudadanos/áreas tienen cuentas propias?
- ¿Se agregó una copia adicional del logo o de la barra de filtros?

## Checklist final

- [ ] Ninguna sugerencia de esta tarea asume o introduce un backend distinto a Google Apps Script + Google Sheets.
- [ ] Si se tocó el `.gs` real, se evaluó su copia embebida `APPS_SCRIPT_CODE`.
- [ ] Los campos de dominio se trataron como específicos del contexto escolar (Colegio Goyavier Campestre), no genéricos.
- [ ] La lista de dependencias se trató como configurable, no hardcodeada de forma distinta a `Configuracion.dependencias`.
- [ ] No se asumieron roles/permisos distintos al único rol `Staff` existente.
- [ ] No se asumió que ciudadanos o áreas tienen cuentas/sesiones propias.
- [ ] No se agregó una copia adicional del logo ni de la barra de filtros.
