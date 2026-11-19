---
description: Aplica esta skill antes de finalizar cualquier cambio a CODE-APPS-SCRIPT-FINAL.gs o a la copia embebida APPS_SCRIPT_CODE dentro de PQRS-FINAL.html, a cualquiera de las 3 apariciones del literal 'PQRS2260', o a cualquier fetch(...) hacia el backend — para prevenir drift entre archivos duplicados y fallos de escritura silenciosos ya observados en este proyecto.
when_to_use: ["actualicé el .gs, ¿hay que tocar algo más?", "voy a cambiar el formato del ID de solicitud", "voy a agregar un fetch nuevo al backend", "por qué el script pegado desde la app no funciona igual que el real", "voy a modificar login_ o inicializarSistema"]
paths: "CODE-APPS-SCRIPT-FINAL.gs, PQRS-FINAL.html"
---

## ⚠ Actualización 2026-11-19 — desfase resuelto con herramienta

La copia embebida `APPS_SCRIPT_CODE` se **regenera** con `python sincronizar_script_embebido.py` y se verifica con `--check`. La herramienta escribe `</script>` como `<\/script>`: sin eso el navegador corta el bloque `<script>` del HTML y la aplicación deja de funcionar. Antes de dar por terminado cualquier cambio al `.gs`: ejecutar la herramienta, `--check` y las pruebas de `pruebas/`. Lo que la sección 1 describe como desfase ya no aplica mientras se use la herramienta.

## Descripción

Esta skill documenta y previene tres fuentes de regresión REALES (no hipotéticas) ya detectadas en PQRS-Goyavier. La más grave es un caso de drift ya consumado: `PQRS-FINAL.html` contiene una segunda copia completa y desactualizada del backend, embebida como template literal, que la propia aplicación presenta como el método oficial de despliegue — y esa copia está rota.

## Objetivo

Que ningún cambio futuro al backend real (`CODE-APPS-SCRIPT-FINAL.gs`) se olvide de reflejarse en la copia embebida (`APPS_SCRIPT_CODE` dentro de `PQRS-FINAL.html`), que ningún cambio al esquema del ID de solicitud deje alguno de los 3 sitios hardcodeados desincronizado, y que ningún `fetch` nuevo hacia el backend repita el patrón `mode:'no-cors'` sin al menos documentar que los errores de escritura se tragan silenciosamente.

## Cuándo debe utilizarse

- Antes de finalizar cualquier edición a `CODE-APPS-SCRIPT-FINAL.gs` — preguntar siempre "¿esta función también existe en `APPS_SCRIPT_CODE` (dentro de `PQRS-FINAL.html`, líneas ~3039-4120)? Si existe, ¿quedó igual? Si no existe, ¿debería agregarse ahí también?"
- Antes de cambiar cualquier cosa relacionada con el formato del ID de solicitud (`PQRS2260` + consecutivo).
- Antes de agregar un nuevo `fetch()` del cliente hacia el Apps Script desplegado.
- Cuando se investigue por qué "seguir las instrucciones de la propia app para desplegar de cero" no funciona (login tradicional falla, `inicializarSistema` no existe, no se puede reenviar observación a un área).

## Instrucciones detalladas

### 1. El caso central: drift entre `.gs` real y `APPS_SCRIPT_CODE` embebido

`PQRS-FINAL.html` incluye, como parte de su modal "📋 Ver Script de Apps Script" (`showAppScript()`/`copyScript()`, líneas 4121-4130), una constante `APPS_SCRIPT_CODE` (línea 3039) que es un template literal con el texto completo de "el" backend. La Configuración de la propia app instruye al usuario a "Pegue el script de integración (ver botón abajo)..." como vía oficial de despliegue.

El problema: esa copia (60,381 caracteres, 29 funciones) **NO es igual** al `CODE-APPS-SCRIPT-FINAL.gs` real (78,854 caracteres, 33 funciones). Le faltan exactamente estas 4 funciones:

| Función | Ubicación real (`.gs`) | Qué rompe si falta |
|---|---|---|
| `login_(usuario, clave)` | línea 1085 | Login tradicional usuario/contraseña no funciona — solo quedaría OAuth de Google. |
| `enviarObsArea_(p, auth)` | línea 1187 | No se puede reenviar la observación/inconformidad del ciudadano de vuelta al área responsable. |
| `_actualizarTokenRespuesta_(id, token)` | línea 395 | El token de respuesta de un solo uso del solicitante no se emite ni se invalida correctamente. |
| `inicializarSistema()` | línea 1362 | **La más crítica**: sin esta función no se crean las pestañas necesarias (`PQRS`, `Seguimientos`, `Configuracion`, `UsuariosPQRS`) ni se siembran las 3 cuentas de staff por defecto — un despliegue desde cero con la copia embebida queda inutilizable. |

**Consecuencia comprobada**: alguien que despliega el sistema de cero siguiendo las propias instrucciones de la app (pegar el script del botón) obtiene un backend que no se puede inicializar, no soporta login tradicional, y no puede reenviar observaciones a áreas.

**Regla operativa**: cualquier cambio a `CODE-APPS-SCRIPT-FINAL.gs` — no solo a estas 4 funciones, a CUALQUIER función — debe evaluarse contra `APPS_SCRIPT_CODE` en `PQRS-FINAL.html`. Hay tres desenlaces aceptables:
1. Actualizar `APPS_SCRIPT_CODE` en el mismo cambio para que quede sincronizado con el `.gs` real.
2. Si no es viable sincronizar de inmediato, señalar explícitamente el drift nuevo introducido como deuda pendiente (no dejarlo pasar en silencio).
3. Si se decide como estrategia de fondo, proponer eliminar la duplicación (por ejemplo, que el botón "Ver Script" lea el `.gs` real en vez de mantener una copia pegada) — pero esto es un cambio de arquitectura que requiere confirmación explícita (ver `architecture-guardian`).

Nunca corregir solo el `.gs` real y dar el cambio por terminado sin mencionar la copia embebida.

### 2. El literal `'PQRS2260'` hardcodeado en al menos 3 sitios

El prefijo de ID de solicitud aparece hardcodeado, como mínimo, en:

- `CODE-APPS-SCRIPT-FINAL.gs:304` y `:310` (dentro de `syncData`/lógica de reconciliación de consecutivos).
- `CODE-APPS-SCRIPT-FINAL.gs:1341` y `:1347` (dentro de `generarId(sheet)`).
- `PQRS-FINAL.html:2013` (`getNextConsecutivo()`), `:3030`, `:3426`/`:3432` (dentro de la copia embebida `APPS_SCRIPT_CODE`), y `:4109`/`:4115` (también dentro de la copia embebida).

Es decir: el literal vive en el `.gs` real, en el cliente HTML, y DE NUEVO dentro de la copia embebida del `.gs` en el HTML — como mínimo 3 "sitios lógicos" (real backend, cliente, copia embebida), varios con 2 apariciones cada uno.

**Regla operativa**: cualquier cambio al esquema de ID (cambiar el prefijo, el padding de ceros, el largo del consecutivo, o pasar a otro esquema) debe aplicarse en los 3 sitios lógicos a la vez, y debe verificarse con una búsqueda de texto completa (`grep -rn "PQRS2260"` sobre ambos archivos) antes de dar el cambio por terminado — no confiar en la memoria de "ya lo cambié donde tocaba".

### 3. `fetch(..., {mode:'no-cors'})` traga errores de escritura silenciosamente

`pushToSheets()` (`PQRS-FINAL.html:1546`) y otro `fetch` similar en línea 2818 usan `mode:'no-cors'`. Esto es necesario porque el backend de Apps Script no está configurado para responder con headers CORS legibles, pero tiene una consecuencia importante: **la respuesta es opaca** (`response.type === 'opaque'`) — el cliente JavaScript no puede leer el status HTTP ni el cuerpo de la respuesta. Un token de sesión inválido, una excepción no capturada en el `.gs`, o una cuota de Apps Script excedida producen el mismo resultado visible para el usuario: nada, la promesa se resuelve igual que si hubiera funcionado.

**Regla operativa**: cualquier `fetch` nuevo hacia el backend que use `mode:'no-cors'` debe:
1. Documentarse explícitamente con un comentario que indique "la respuesta es opaca, no se puede verificar éxito/fracaso desde aquí".
2. Si la operación es crítica (escritura de datos, no solo lectura de estado), considerar una verificación posterior activa — por ejemplo, releer el dato recién escrito en el siguiente `pullFromSheets()` (línea 2947, polling cada 120s vía `setInterval` en línea 1533) y comparar, o mostrar al usuario un estado "pendiente de confirmar" en vez de asumir éxito inmediato.
3. Nunca asumir silenciosamente que un `fetch` con `no-cors` tuvo éxito solo porque no lanzó una excepción de red.

## Reglas obligatorias

1. Todo cambio a una función de `CODE-APPS-SCRIPT-FINAL.gs` debe evaluarse contra su equivalente (si existe) en `APPS_SCRIPT_CODE` dentro de `PQRS-FINAL.html`, y sincronizarse o señalarse como deuda explícita — nunca ignorarse en silencio.
2. Las 4 funciones ya identificadas como faltantes en la copia embebida (`login_`, `enviarObsArea_`, `_actualizarTokenRespuesta_`, `inicializarSistema`) deben tratarse como deuda conocida citable — si se toca cualquiera de ellas en el `.gs` real, es el momento natural de corregir también la copia embebida.
3. Cualquier cambio al esquema del ID de solicitud debe aplicarse simultáneamente en los 3 sitios lógicos donde vive `'PQRS2260'`, verificado con búsqueda de texto completa antes de cerrar el cambio.
4. Cualquier `fetch` nuevo con `mode:'no-cors'` debe documentar que la respuesta es opaca y, si la operación es crítica, incluir alguna forma de verificación posterior.
5. Nunca declarar un cambio al backend como "completo" sin haber revisado explícitamente si afecta a la copia embebida.

## Criterios de validación

- ¿Se modificó `CODE-APPS-SCRIPT-FINAL.gs`? Si sí, ¿se buscó la función equivalente en `APPS_SCRIPT_CODE` (`PQRS-FINAL.html` ~3039-4120)? ¿Se sincronizó o se señaló el drift explícitamente?
- ¿Se tocó `login_`, `enviarObsArea_`, `_actualizarTokenRespuesta_` o `inicializarSistema`? Si sí, ¿se actualizó también (o se decidió explícitamente no actualizar, con razón dada) la copia embebida?
- ¿Se cambió algo del formato/esquema del ID de solicitud? Si sí, ¿se verificó con búsqueda de texto (`PQRS2260`) que los 3 sitios lógicos quedaron consistentes?
- ¿Se agregó un `fetch` nuevo hacia el backend con `mode:'no-cors'`? Si sí, ¿está documentado que la respuesta es opaca? ¿Se consideró verificación posterior para operaciones críticas?

## Checklist final

- [ ] Todo cambio a `CODE-APPS-SCRIPT-FINAL.gs` fue evaluado contra la copia embebida `APPS_SCRIPT_CODE`.
- [ ] Si se tocó alguna de las 4 funciones ya conocidas como faltantes en la copia embebida, se sincronizó o se documentó explícitamente por qué no.
- [ ] Cualquier cambio al esquema del ID `PQRS2260` se aplicó y verificó en los 3 sitios lógicos (backend real, cliente, copia embebida).
- [ ] Cualquier `fetch` nuevo con `no-cors` documenta la opacidad de la respuesta y considera verificación posterior si la operación es crítica.
- [ ] No se cerró el cambio asumiendo silenciosamente que "ya quedó sincronizado" sin verificación explícita (grep o lectura directa).
