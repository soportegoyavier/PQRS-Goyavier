---
description: Aplica esta skill cuando se proponga o realice cualquier cambio estructural en PQRS-Goyavier — añadir un framework, un build step, un tercer archivo fuente, una nueva pestaña de UI con su propia barra de filtros, o cualquier modal/badge nuevo — para forzar que respete la arquitectura de 2 archivos sin build ya decidida y reutilice los helpers existentes en vez de duplicarlos.
when_to_use: ["vamos a agregar React/Vue a esto", "separemos el HTML del JS", "creemos un build con Vite/webpack", "agreguemos una pestaña nueva con buscador y filtro de fecha", "necesito un modal nuevo", "quiero guardar algo en localStorage"]
paths: "PQRS-FINAL.html, CODE-APPS-SCRIPT-FINAL.gs"
---

## Descripción

PQRS-Goyavier es deliberadamente un proyecto de **2 archivos sin build**: `PQRS-FINAL.html` (4178 líneas, ~476KB — HTML+CSS+JS del cliente en un único archivo) y `CODE-APPS-SCRIPT-FINAL.gs` (1429 líneas, ~79KB — el backend de Google Apps Script). No hay `package.json`, no hay `node_modules`, no hay bundler, no hay transpilador, no hay framework de componentes. Esta skill existe para que ningún cambio futuro introduzca complejidad arquitectónica parcial (un framework a medias, un build step que solo cubre parte del código, una tercera fuente de verdad) sin que exista antes un plan completo y explícito de migración aprobado por quien mantiene el proyecto.

El propio código ya documenta esta decisión: el comentario en `PQRS-FINAL.html` línea ~1372 dice literalmente:

```js
// ════════════════════════════════════════════════════════════════
//  INIT — Sheets es la única fuente de verdad. Sin localStorage.
// ════════════════════════════════════════════════════════════════
```

Esa frase resume dos invariantes a la vez: (1) arquitectura de archivo único sin build, y (2) Google Sheets — nunca `localStorage` ni ningún otro almacenamiento del navegador — es la fuente de verdad de los datos. Ver `data-layer-guardian` para el detalle de por qué Sheets es la fuente de verdad; esta skill se enfoca en la forma del código, no en dónde vive el dato.

## Objetivo

Evitar que el proyecto derive hacia un estado híbrido inmantenible: ni "sigue siendo Apps Script puro" ni "ya migró a un framework moderno", sino algo a medio camino que nadie puede desplegar ni depurar con confianza. Y, dentro de la arquitectura actual, evitar la duplicación de patrones de UI que ya existen (badges, modales, barras de filtro) cuando se agrega funcionalidad nueva.

## Cuándo debe utilizarse

- Antes de aceptar cualquier propuesta que implique: agregar React, Vue, Svelte, Angular, cualquier framework de componentes, cualquier bundler (Vite, webpack, esbuild, Rollup), TypeScript con paso de compilación, o un `package.json` con dependencias de build.
- Antes de crear un tercer archivo fuente de lógica de negocio (por ejemplo, un `.gs` adicional o un `.js` externo cargado por el HTML) sin haber verificado que Apps Script permite múltiples archivos `.gs` en el mismo proyecto (sí lo permite) y sin justificar por qué se separa.
- Antes de agregar una nueva pestaña de UI (como Bandeja, Seguimiento, Correos o Historial) que necesite buscador + filtro de mes + filtro de fecha desde/hasta + botón "Limpiar".
- Antes de agregar un modal nuevo o un badge/etiqueta de estado nuevo.
- Antes de introducir cualquier `localStorage.setItem`, `sessionStorage.setItem`, IndexedDB, o cualquier mecanismo de persistencia en el navegador que no sea puramente de UI efímera (por ejemplo, recordar qué pestaña estaba abierta está bien; cachear datos de solicitudes NO).

## Instrucciones detalladas

### 1. No introducir un framework ni un build parcial

Si se te pide "modernizar" el frontend, migrar a componentes, o agregar un bundler:

1. Detén la implementación inmediata. No generes un `package.json`, `vite.config.js`, ni conviertas secciones del HTML en componentes de un framework.
2. Señala explícitamente que esto es un cambio arquitectónico mayor que requiere:
   - Migrar TODO el archivo de una vez (no solo la pestaña que se está tocando), porque un HTML mitad-vanilla-mitad-framework es peor que cualquiera de los dos extremos.
   - Un plan de cómo se seguiría desplegando en Google Apps Script (`HtmlService.createHtmlOutputFromFile`, `.gs` líneas 102 y 138 para `doGet`/`doPost`) — Apps Script no ejecuta Node ni sirve `node_modules`, así que cualquier build tendría que compilarse a un único archivo estático antes de subirse, y ese paso de build tendría que documentarse y automatizarse.
   - Confirmación explícita de la persona que mantiene el proyecto, no solo inferencia de la conversación.
3. Si la persona confirma que quiere proceder de todos modos, documenta el plan completo (qué se migra, en qué orden, cómo se prueba en Apps Script real) antes de tocar código.

### 2. Reutilizar helpers de UI existentes, no reinventarlos

Antes de escribir un badge de estado nuevo, revisa que ya existen y están bien hechos:

- `badgeEstado(estado)` — `PQRS-FINAL.html:1872` — genera el HTML del badge de color según `Borrador/Abierto/Proceso/Cerrado/Apelado`.
- `badgeHtml(tipo)` — `PQRS-FINAL.html:1877` — genera el HTML del badge según el tipo de solicitud (Petición/Queja/Reclamo/Felicitación/Sugerencia).

Antes de escribir apertura/cierre de un modal nuevo con `style.display` manual o clases ad hoc, usa el patrón ya existente:

- `openModal(id)` — `PQRS-FINAL.html:4154` — `document.getElementById(id).classList.add('open')`.
- `closeModal(id)` — `PQRS-FINAL.html:4155` — `document.getElementById(id).classList.remove('open')`.
- El patrón de marcado es un par `.overlay` + `.modal` compartiendo el mismo `id` lógico. Ya existen 7 modales (`modal-guardar`, `modal-seg`, `modal-despacho`, `modal-obs-area`, `modal-historial-detalle`, `modal-script`, `modal-confirm-envio`) — un modal nuevo debe seguir exactamente esa estructura de markup, no inventar una nueva.

### 3. No triplicar (ni cuadruplicar) el patrón de barra de filtros

El patrón "buscador + filtro de mes + fecha desde/hasta + botón Limpiar" ya está duplicado 3 veces casi textualmente:

- Seguimiento: IDs `seg-search`, `seg-dep`, `seg-mes`, `seg-desde`, `seg-hasta` (markup `PQRS-FINAL.html:836-857`, lógica en `renderSeguimiento()`).
- Correos: IDs `cor-search`, `cor-mes`, `cor-desde`, `cor-hasta` (markup `PQRS-FINAL.html:867-880`, lógica en `renderCorreos()`).
- Historial: IDs `hist-search`, `hist-dep`, `hist-mes`, `hist-desde`, `hist-hasta` (markup `PQRS-FINAL.html:894-910`, lógica en `renderHistorial()`).

Si se necesita esta barra de filtros para una 4ª pestaña (o para cualquier vista nueva), **NO copies y pegues una 4ª variante**. En su lugar:

1. Extrae una función que genere el markup de la barra de filtros parametrizada por prefijo de IDs (`seg-`, `cor-`, `hist-`, el nuevo prefijo) y la inserte donde corresponda, o
2. Extrae la lógica de filtrado común (comparación de texto, comparación de mes, comparación de rango de fechas) en una función compartida que reciba los valores ya leídos del DOM, dejando que cada `render*()` solo se encargue de leer sus propios inputs y pintar su propia lista.

Esta extracción es deuda técnica ya identificada — abordarla al tocar una de las 3 vistas existentes es bienvenido, pero como mínimo nunca agregues una 4ª copia manual.

### 4. Nunca usar almacenamiento del navegador como fuente de datos

Google Sheets (vía las funciones `getData()`/`syncData()` en el `.gs`, líneas 194 y 347) es la única fuente de verdad. Está prohibido:

- Cachear listas de solicitudes, seguimientos o configuración en `localStorage`/`sessionStorage` como si fueran la fuente de datos (aunque sea "temporalmente" mientras se sincroniza).
- Confiar en el estado en memoria del cliente (`DB` global en el HTML) más allá de la sesión actual de la pestaña del navegador.

Está permitido usar almacenamiento del navegador solo para preferencias de UI puramente cosméticas (ej. qué pestaña estaba activa), nunca para datos de negocio.

## Reglas obligatorias

1. Nunca agregar un framework de componentes, bundler o paso de compilación sin plan de migración completo y confirmación explícita del mantenedor.
2. Nunca crear un tercer archivo de lógica de negocio sin justificación explícita de por qué no cabe en los 2 existentes.
3. Siempre reutilizar `badgeEstado()`, `badgeHtml()`, `openModal()`, `closeModal()` para sus propósitos respectivos — nunca reimplementar badges o apertura/cierre de modal con markup o lógica ad hoc.
4. Nunca crear una 4ª copia manual de la barra de filtros (buscador + mes + fecha desde/hasta + Limpiar) — extraer en su lugar, o como mínimo replicar exactamente el patrón existente con el prefijo de IDs correspondiente.
5. Nunca usar `localStorage`/`sessionStorage`/IndexedDB como fuente de verdad de datos de negocio — solo Google Sheets lo es.
6. Cualquier cambio estructural grande debe declararse explícitamente como tal antes de implementarse, nunca colarse como "mientras estaba aquí, también...".

## Criterios de validación

- ¿El cambio propuesto agrega dependencias de build (`package.json`, bundler, transpilador)? Si sí, ¿existe un plan de migración completo y confirmación explícita? Si no hay ninguna de las dos, detener y preguntar.
- ¿El cambio agrega un badge, modal o barra de filtros nuevos? Si sí, ¿se reutilizaron `badgeEstado()`/`badgeHtml()`/`openModal()`/`closeModal()` o el patrón de filtros existente en vez de reinventarlos?
- ¿El cambio introduce una 4ª variante de la barra de filtros? Si sí, ¿se evaluó extraer el patrón en vez de copiar?
- ¿El cambio guarda datos de negocio (solicitudes, seguimientos, configuración) en almacenamiento del navegador? Si sí, rechazar — Sheets debe seguir siendo la única fuente de verdad.
- ¿Se creó un archivo fuente nuevo (tercer `.gs`, JS externo, CSS externo)? Si sí, ¿hay justificación explícita y se actualizó el despliegue (`doGet`, includes de HtmlService) de forma consistente?

## Checklist final

- [ ] No se agregó ningún framework, bundler ni paso de build sin plan completo y confirmación explícita.
- [ ] No se creó un tercer archivo de lógica de negocio sin justificación.
- [ ] Badges nuevos reutilizan `badgeEstado()`/`badgeHtml()`; no hay markup de badge duplicado.
- [ ] Modales nuevos reutilizan `openModal()`/`closeModal()` y el patrón `.overlay`+`.modal`.
- [ ] No se agregó una 4ª copia de la barra de filtros sin evaluar extracción del patrón compartido.
- [ ] Ningún dato de negocio se guarda en `localStorage`/`sessionStorage`/IndexedDB.
- [ ] Sheets sigue siendo la única fuente de verdad de los datos, tal como documenta el comentario en `PQRS-FINAL.html:1372`.
