---
description: Aplica esta skill cuando se agregue o modifique cualquier render de UI en PQRS-FINAL.html que interpole datos de solicitantes, ciudadanos o áreas vía innerHTML — porque el archivo no tiene NINGUNA función de escape/sanitización HTML y ya interpola datos no confiables directamente, un patrón de XSS almacenado real.
when_to_use: ["voy a mostrar la descripción/observación del ciudadano en pantalla", "voy a agregar una tarjeta o fila nueva a la tabla", "voy a usar innerHTML con datos de la solicitud", "necesito un badge o modal nuevo"]
paths: "PQRS-FINAL.html"
---

## Descripción

`PQRS-FINAL.html` es el cliente completo (HTML+CSS+JS) en un único archivo, sin framework, con manipulación directa del DOM vía `innerHTML`. **No existe ninguna función de escape o sanitización de HTML en todo el archivo.** Prácticamente toda función de render (`renderBandeja`, `renderSolicitudCard`, `abrirEnvio`, `renderCorreos`, `renderHistorial`, el constructor de línea de tiempo `buildTimeline`, etc.) interpola strings directamente en `.innerHTML =`. Como esos datos provienen de envíos de Google Forms **no autenticados** y de cajas de texto de "observación" enviadas por ciudadanos y áreas **tampoco autenticadas** (ver enlaces sin token en skill `security-guardian`), esto es un patrón de **XSS almacenado real**, no un riesgo teórico: cualquier ciudadano puede escribir `<img src=x onerror=alert(1)>` como su nombre, descripción u observación en el Google Form público, y ese payload se ejecutará en el navegador de cualquier miembro del staff que abra esa solicitud.

## Objetivo

Que ningún `innerHTML` nuevo que incluya datos de solicitantes/ciudadanos/áreas se agregue sin pasar antes por una función de escape, y sentar las bases para cerrar la brecha existente (agregar la función de escape que falta y aplicarla retroactivamente a los renders ya existentes) cuando se toque código cercano.

## Cuándo debe utilizarse

- Antes de agregar o modificar cualquier función de render que construya HTML a partir de campos como `Nombre`, `Telefono`, `Correo`, `Estudiante`, `Descripcion`, `ObservacionSolicitante`, o cualquier campo de texto libre de `Seguimientos.Respuesta`.
- Antes de agregar una tarjeta, fila de tabla, o entrada de línea de tiempo nueva.
- Antes de agregar un badge o modal nuevo (ver también `architecture-guardian` para la parte de reutilización de esos helpers).
- Cuando se discuta cualquier reporte de comportamiento raro en la interfaz que podría ser HTML/JS inyectado desde un envío de formulario.

## Instrucciones detalladas

### 1. Identificar el patrón de riesgo antes de escribir código nuevo

Los siguientes son los puntos de render conocidos que interpolan datos no confiables directamente en `innerHTML` sin escape:

- `renderBandeja` — tarjetas de la bandeja de entrada, incluye `Nombre`, `Descripcion`, etc.
- `renderSolicitudCard` — tarjeta de detalle de una solicitud.
- `abrirEnvio` — vista de envío/despacho, incluye datos del solicitante.
- `renderCorreos` — vista de correos pendientes.
- `renderHistorial` — vista de historial.
- `buildTimeline(sol)` (línea 1898) — construye la línea de tiempo interpretando `seguimientos[].tipo` e incluyendo el texto de `Respuesta` de cada seguimiento, que puede venir de un área externa (`enviarObsArea_`) o de una observación de ciudadano.

Cualquier función nueva que siga este mismo patrón (construir un string con template literals que incluya un campo de texto libre del solicitante/ciudadano/área, y asignarlo a `.innerHTML`) hereda el mismo riesgo.

### 2. Agregar y usar una función de escape

Antes de agregar cualquier `innerHTML` nuevo con datos no confiables, se debe introducir (si aún no existe al momento de la tarea) una función de escape mínima, por ejemplo:

```js
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

Y usarla envolviendo cada interpolación de campo de texto libre en el `innerHTML` nuevo: `${escapeHtml(sol.Nombre)}`, `${escapeHtml(sol.Descripcion)}`, `${escapeHtml(seg.Respuesta)}`, etc. Los campos que son enums controlados por el propio sistema (como `Estado`, ya pasado por `badgeEstado()`, o `TipoSolicitud`, ya pasado por `badgeHtml()`) no necesitan escape porque no contienen texto libre del usuario — pero cualquier campo de texto libre síi lo necesita.

### 3. Marcar explícitamente la brecha existente, no fingir que no existe

Si la tarea toca cualquiera de las funciones de render listadas arriba (o agrega una nueva junto a ellas) y el alcance de la tarea lo permite razonablemente, es el momento natural de:
1. Agregar la función `escapeHtml` (u homóloga) si aún no existe.
2. Aplicarla al menos al render que se está tocando.
3. Señalar explícitamente en la respuesta al usuario que el resto de renders (`renderBandeja`, `renderSolicitudCard`, `abrirEnvio`, `renderCorreos`, `renderHistorial`, `buildTimeline`) siguen sin escape y quedan como deuda pendiente, para que quede documentado y no se asuma resuelto globalmente por un fix parcial.

Si el alcance de la tarea es acotado y no amerita tocar todos los renders, como mínimo el código NUEVO agregado en esa tarea debe estar sanitizado — no está permitido agregar un `innerHTML` nuevo sin escape argumentando "el resto del archivo tampoco lo tiene".

### 4. Reutilizar los helpers de UI ya buenos

`badgeEstado(estado)` (línea 1872) y `badgeHtml(tipo)` (línea 1877) son helpers reutilizables y correctos — no interpolan texto libre, solo mapean un enum conocido a un HTML fijo. Presérvalos y reutilízalos en vez de escribir markup de badge nuevo a mano (ver también `architecture-guardian`).

### 5. No crear una 4ª copia del patrón de filtros

Ver el detalle completo en `architecture-guardian` — el patrón de barra de filtros (buscador + mes + fecha desde/hasta + Limpiar) ya está triplicado (`seg-*`, `cor-*`, `hist-*`). Si esta skill se dispara en el contexto de agregar una vista nueva, recuerda también no agregar una 4ª copia manual del filtro sin evaluar extracción.

## Reglas obligatorias

1. Ningún `innerHTML` nuevo que incluya un campo de texto libre proveniente de un solicitante, ciudadano o área puede omitir una función de escape.
2. Los enums controlados por el sistema (`Estado`, `TipoSolicitud`) siguen renderizándose vía `badgeEstado()`/`badgeHtml()`, no necesitan escape adicional pero tampoco deben reimplementarse a mano.
3. Si la tarea toca un render existente sin escape, se debe escapar como mínimo la parte tocada y señalar explícitamente el resto como deuda pendiente — nunca dar la impresión de que "ya se arregló todo".
4. No introducir un framework de templating ni un sanitizador de terceros sin plan (ver `architecture-guardian`) — la función de escape debe ser una utilidad simple, autocontenida, del mismo archivo.
5. No crear una 4ª copia del patrón de barra de filtros al agregar una vista nueva.

## Criterios de validación

- ¿El cambio agrega o modifica una función de render que usa `innerHTML`? Si sí, ¿todos los campos de texto libre de solicitante/ciudadano/área pasan por una función de escape?
- ¿Existe ya una función de escape en el archivo al momento de este cambio? Si no existe y se está agregando `innerHTML` con datos no confiables, ¿se agregó la función de escape como parte de este cambio?
- ¿Se tocó una función de render ya existente sin escape (`renderBandeja`, `renderSolicitudCard`, `abrirEnvio`, `renderCorreos`, `renderHistorial`, `buildTimeline`)? Si sí, ¿se escapó al menos la parte modificada y se documentó el resto como deuda?
- ¿Se reutilizaron `badgeEstado()`/`badgeHtml()` para los enums, en vez de reimplementarlos?
- ¿Se evitó agregar una 4ª copia manual de la barra de filtros?

## Checklist final

- [ ] Todo `innerHTML` nuevo con datos de solicitante/ciudadano/área pasa por una función de escape.
- [ ] Si no existía función de escape antes de esta tarea y se agregó `innerHTML` con datos no confiables, se introdujo `escapeHtml()` (o equivalente) en este cambio.
- [ ] Si se tocó un render existente sin escape, se escapó la parte modificada y se documentó explícitamente el resto como deuda pendiente.
- [ ] Badges reutilizan `badgeEstado()`/`badgeHtml()`, no se reimplementaron a mano.
- [ ] No se agregó una 4ª copia del patrón de filtros.
- [ ] La respuesta final al usuario menciona explícitamente si quedó deuda de sanitización pendiente en otros renders.
