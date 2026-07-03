---
description: Aplica esta skill al tocar la máquina de estados de una solicitud PQRSF, el cálculo de plazos/SLA (addBusinessDays, businessDaysRemaining, deadlineLabel, getAlertClass), el ciclo de vida de seguimientos/línea de tiempo, o el envío de correos vía Gmail — para no reimplementar esta lógica de forma divergente ni romper el único cálculo de SLA existente, que hoy solo vive en el cliente.
when_to_use: ["voy a agregar un estado nuevo a la solicitud", "voy a cambiar cómo se calculan los días hábiles/plazo de respuesta", "voy a modificar el envío de correos", "necesito una versión server-side del cálculo de vencimiento", "voy a agregar un evento nuevo a la línea de tiempo"]
paths: "PQRS-FINAL.html, CODE-APPS-SCRIPT-FINAL.gs"
---

## Descripción

Esta skill cubre la lógica de negocio real de PQRS-Goyavier — no la de otros proyectos del mismo autor (Activos/Préstamos son de Zaiko, no de aquí). El dominio es un sistema PQRSF (Petición/Queja/Reclamo/Felicitación/Sugerencia) de intake y seguimiento para la Secretaría Académica del Colegio Goyavier Campestre. La lógica central que debe protegerse de reimplementaciones divergentes es: la máquina de estados de una solicitud, el cálculo de SLA/plazo de respuesta, y el ciclo de vida de seguimientos que alimenta la línea de tiempo.

## Objetivo

Que la máquina de estados y el cálculo de SLA tengan una única fuente de verdad de comportamiento (aunque hoy solo exista en el cliente), que ningún estado nuevo se agregue sin actualizar todos los puntos que interpretan el enum `Estado`, y que el envío de correos siga el patrón dual ya establecido (Gmail API con token propio del staff, con fallback a `GmailApp`).

## Cuándo debe utilizarse

- Antes de agregar, quitar o renombrar un valor del enum `Estado` (`Borrador`, `Abierto`, `Proceso`, `Cerrado`, `Apelado`).
- Antes de modificar `addBusinessDays`, `businessDaysRemaining`, `deadlineLabel`, `getAlertClass` (`PQRS-FINAL.html:1691-1731`).
- Antes de modificar `enviarSolicitud(sendNow)` (línea 2293) o cualquier lógica que dispare un cambio de estado.
- Antes de modificar `buildTimeline(sol)` (línea 1898) o el enum `seguimientos[].tipo`.
- Antes de tocar el envío de correo (`sendViaGmailApi_`, `.gs:1051`, o `GmailApp.sendEmail`).
- Si se plantea crear una versión server-side del cálculo de SLA (hoy no existe).

## Instrucciones detalladas

### 1. Máquina de estados — `Estado`

Los valores válidos y sus transiciones esperadas:

```
Borrador → Abierto → Proceso → Cerrado
                              ↘ Apelado
```

- `Borrador`: fila creada por `onFormSubmit(e)` (`.gs:19-100`) al recibir un envío de Google Form, aún sin procesar por Secretaría.
- `Abierto`: staff revisó en Bandeja de Entrada, asignó `Dependencia`, llamó `enviarSolicitud(sendNow=false)` — se difirió a Correos Pendientes, aún no se notificó al área.
- `Proceso`: staff llamó `enviarSolicitud(sendNow=true)` — se envió ya (abre Gmail compose), el área fue notificada.
- `Cerrado`: el ciudadano recibió el enlace de un solo uso y confirmó el cierre.
- `Apelado`: rama lateral — el ciudadano usó el enlace de un solo uso para presentar una observación/inconformidad en vez de cerrar.

**Regla operativa**: si se agrega un estado nuevo (o se elimina/renombra uno existente), hay que actualizar TODOS estos puntos, no solo uno:
- `badgeEstado(estado)` (línea 1872) — el mapeo de color/etiqueta del badge.
- `deadlineLabel(sol)` y `getAlertClass(sol)` (líneas 1715-1731) — ambas tienen un caso especial `if(sol.estado === 'Cerrado')` que detiene el cálculo de plazo; un estado nuevo terminal (análogo a `Cerrado`) probablemente necesita el mismo tratamiento.
- `enviarSolicitud(sendNow)` (línea 2293) — la lógica que decide a qué estado transicionar.
- `buildTimeline(sol)` (línea 1898) — cómo se representa el evento de cambio de estado en la línea de tiempo.
- Cualquier filtro por estado en `renderBandeja`, `renderSeguimiento`, `renderCorreos`, `renderHistorial`.
- El backend (`CODE-APPS-SCRIPT-FINAL.gs`) si valida o depende del valor de `Estado` en algún punto (ej. `onFormSubmit`, `syncData`).

### 2. Cálculo de SLA — única fuente de verdad, hoy SOLO en el cliente

`addBusinessDays(dateStr, days)` y `businessDaysRemaining(fechaStr)` (`PQRS-FINAL.html:1691-1713`) calculan el vencimiento: toman `Configuracion.diasRespuesta` (default 15 si no está configurado) como número de días HÁBILES (excluyendo sábado `dow===6` y domingo `dow===0`) a sumar desde la fecha de la solicitud. `deadlineLabel(sol)`/`getAlertClass(sol)` (líneas 1715-1731) traducen el resultado a una etiqueta visual: rojo/"Vencido" si ya pasó el plazo, amarillo si quedan `alertaDias` (default 2) días hábiles o menos, verde en caso contrario. Ambas funciones tratan `Estado === 'Cerrado'` como caso especial que detiene el cálculo (una solicitud cerrada no puede estar "vencida").

**Advertencia crítica de este proyecto**: este cálculo SOLO existe client-side hoy. No hay una función equivalente en `CODE-APPS-SCRIPT-FINAL.gs`. Esto significa:
- Cualquier reporte, notificación automática, o proceso batch que se ejecute desde Apps Script (por ejemplo, un trigger de tiempo que revise solicitudes vencidas) NO puede reutilizar esta lógica directamente — tendría que reimplementarse en `.gs`.
- **Riesgo real de divergencia**: si alguna vez se implementa una versión server-side de este cálculo, debe replicar EXACTAMENTE la misma semántica (días hábiles excluyendo sábado y domingo, lectura de `diasRespuesta`/`alertaDias` desde `Configuracion` con los mismos defaults 15/2, mismo trato especial para `Cerrado`) — de lo contrario, el cliente y el servidor mostrarán/actuarán sobre plazos distintos para la misma solicitud, lo cual sería un bug de negocio serio (ej. el staff ve "no vencido" en pantalla pero el servidor ya mandó una alerta de vencimiento, o viceversa).
- Cualquier cambio a la lógica de cálculo (ej. cambiar cómo se cuentan días hábiles, agregar festivos colombianos como excepción) debe hacerse pensando que algún día podría necesitar una copia server-side — documentar la lógica con claridad, no solo parchear el cliente.

**Regla operativa**: si la tarea agrega o modifica el cálculo de SLA, hacerlo en `addBusinessDays`/`businessDaysRemaining` (no crear un cálculo paralelo en otra función), y si se crea una versión server-side, verificar equivalencia exacta con casos de prueba compartidos (mismas fechas de entrada, mismo resultado).

### 3. Ciclo de vida de seguimientos y línea de tiempo

`Seguimientos` (pestaña `SEG_SHEET`) registra eventos con columnas `PQRS_ID, Fecha, Respuesta, Estado, RegistradoEn, Tipo, Autor, SegKey` (definidas en `inicializarSistema()`, `.gs:1374`, y usadas en `getData()`). `buildTimeline(sol)` (`PQRS-FINAL.html:1898-1954`) reconstruye la línea de tiempo completa **client-side**, interpretando el campo `Tipo` de cada seguimiento como un enum de tipo de evento (ej. despacho al área, respuesta del área, observación del ciudadano, cierre).

**Regla operativa**: si se agrega un tipo de evento nuevo a `Seguimientos.Tipo`, debe:
1. Manejarse explícitamente en `buildTimeline(sol)` — un tipo no reconocido silenciosamente no se romperá pero puede renderizarse de forma genérica/incorrecta.
2. Escribirse consistentemente por quien genera el seguimiento (staff vía `enviarSolicitud`, área vía `enviarObsArea_`/`guardarRespuestaArea_`, o ciudadano vía `guardarRespuestaSolicitante_`) — no inventar valores de `Tipo` ad hoc en un solo punto de escritura.
3. Recordar que `Seguimientos.PQRS_ID` se relaciona con `PQRS.ID` por coincidencia exacta de string (ver `data-layer-guardian`) — cualquier seguimiento nuevo debe usar el ID exacto de la solicitud padre.

### 4. Correo — Gmail API con token del staff, `GmailApp` como fallback

El envío de correo es 100% Gmail, con dos rutas:
1. **Preferida**: si el staff está logueado con Google, se usa su propio token OAuth con scope `gmail.send` (`sendViaGmailApi_`, `.gs:1051-1082`) — el correo se envía "como" ese miembro del staff, desde su propia cuenta de Gmail. Esta función construye el mensaje RFC 2822 a mano (base64, headers `To`/`Subject`/`From`/`Reply-To`) y lo postea a `gmail.googleapis.com/gmail/v1/users/me/messages/send`. Si el token expiró o es inválido (HTTP 401/403), lanza `Error('TOKEN_EXPIRED')` — el llamador debe manejar este caso (típicamente re-pidiendo el permiso `gmail.send` al staff).
2. **Fallback**: `GmailApp.sendEmail(...)` — envía desde la cuenta dueña del script (la cuenta bajo la cual está desplegado el Apps Script), usado cuando no hay token OAuth del staff disponible (ej. login tradicional usuario/contraseña vía `login_`).

**Regla operativa**: cualquier envío de correo nuevo debe respetar este patrón dual — intentar Gmail API con el token del staff si está disponible, capturar `TOKEN_EXPIRED` explícitamente, y caer a `GmailApp` si no hay token o si se prefiere explícitamente esa ruta. No introducir un tercer proveedor de correo (SendGrid, SMTP directo, etc.) sin que sea una decisión de arquitectura explícita — este sistema no tiene ninguna dependencia externa de terceros hoy, y agregar una rompería ese invariante sin discusión previa.

## Reglas obligatorias

1. Cualquier estado nuevo o modificado en el enum `Estado` debe reflejarse en `badgeEstado`, `deadlineLabel`/`getAlertClass`, `enviarSolicitud`, `buildTimeline`, y todos los filtros por estado en las vistas.
2. El cálculo de SLA vive únicamente en `addBusinessDays`/`businessDaysRemaining` — no crear una segunda implementación paralela en el cliente.
3. Si se crea una versión server-side del cálculo de SLA, debe ser exactamente equivalente a la versión cliente (mismos defaults, mismo trato de días hábiles, mismo caso especial para `Cerrado`) — verificado con casos de prueba compartidos.
4. Cualquier tipo de evento nuevo en `Seguimientos.Tipo` debe manejarse explícitamente en `buildTimeline` y escribirse de forma consistente por todos los puntos que generan seguimientos.
5. Ningún seguimiento nuevo debe reformatear el `PQRS_ID` — debe coincidir exactamente con `PQRS.ID`.
6. El envío de correo nuevo debe seguir el patrón dual Gmail API (token del staff) + `GmailApp` (fallback) — no introducir un proveedor de correo externo sin decisión de arquitectura explícita.

## Criterios de validación

- ¿Se agregó/modificó un estado del enum `Estado`? Si sí, ¿se actualizaron los 5-6 puntos listados en la regla 1?
- ¿Se tocó el cálculo de SLA? Si sí, ¿se hizo en `addBusinessDays`/`businessDaysRemaining` (no en una función paralela)?
- ¿Se propuso o creó una versión server-side del cálculo de SLA? Si sí, ¿se verificó equivalencia exacta con la versión cliente?
- ¿Se agregó un tipo de evento nuevo a `Seguimientos.Tipo`? Si sí, ¿se maneja en `buildTimeline` y se escribe consistentemente?
- ¿Se agregó envío de correo nuevo? Si sí, ¿sigue el patrón Gmail API + fallback `GmailApp`, sin introducir un proveedor externo?

## Checklist final

- [ ] Todo cambio al enum `Estado` está reflejado en badge, cálculo de plazo, transición (`enviarSolicitud`), línea de tiempo, y filtros de vista.
- [ ] El cálculo de SLA sigue centralizado en `addBusinessDays`/`businessDaysRemaining`, sin una segunda implementación paralela.
- [ ] Si existe una versión server-side del SLA, es exactamente equivalente a la del cliente (verificado con casos compartidos).
- [ ] Todo tipo de evento nuevo en `Seguimientos.Tipo` se maneja en `buildTimeline` y se escribe de forma consistente.
- [ ] Ningún seguimiento nuevo reformatea `PQRS_ID` respecto a `PQRS.ID`.
- [ ] El envío de correo respeta el patrón dual Gmail API (token staff) + `GmailApp` (fallback), sin proveedor externo nuevo no discutido.
