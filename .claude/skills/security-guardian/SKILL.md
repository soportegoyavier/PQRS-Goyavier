---
description: Aplica esta skill antes de tocar autenticación, autorización, tokens, contraseñas, o cualquier endpoint público (action=... en doGet/doPost) de PQRS-Goyavier — porque el sistema ya tiene contraseñas en texto plano, un único rol sin permisos granulares, y un endpoint público (responderArea) sin token real, vulnerable a IDOR.
when_to_use: ["voy a agregar un endpoint público nuevo", "necesito una acción sensible nueva (borrar, exportar, resetear)", "voy a cambiar cómo se guardan las contraseñas", "voy a agregar un rol nuevo o permisos diferenciados", "cómo funciona el login", "el token va en la URL, ¿eso es un problema?"]
paths: "CODE-APPS-SCRIPT-FINAL.gs, PQRS-FINAL.html"
---

## ⚠ Actualización 2026-11-19 — perfiles (prevalece sobre la sección 2 y las reglas que hablan de un único rol)

Existen tres perfiles (`Secretaria`, `Talento Humano`, `Rectoria`) tomados de la columna `Perfil` de `UsuariosPQRS`; el token de sesión lleva `perfil`. Un usuario sin perfil NO entra (falla cerrado) y una sesión sin perfil se rechaza. La autorización por bandeja se aplica en el servidor: `getData` filtra, `syncData` rechaza filas ajenas y `enviarObsArea_` comprueba acceso. El token `TokenRespuesta` ya no se envía al navegador. Toda función nueva que lea o escriba solicitudes debe recibir `auth` y usar `perfilVeBandeja_`. Siguen vigentes los puntos 1, 3 y 4 (claves en texto plano, `responderArea` sin token real, token de sesión por query string).

## Descripción

PQRS-Goyavier tiene un modelo de seguridad mínimo y con debilidades ya conocidas y documentadas aquí — no hipotéticas. Esta skill existe para que ningún cambio futuro (a) agregue más secretos en texto plano al código fuente, (b) asuma que existen roles/permisos granulares que en realidad no existen, o (c) repita el patrón de "endpoint público sin token real" que ya constituye una brecha IDOR (Insecure Direct Object Reference) comprobada en `responderArea`.

## Objetivo

Evitar regresiones de seguridad nuevas y, cuando la tarea lo permita, avanzar hacia cerrar las brechas ya identificadas (especialmente el endpoint `responderArea` sin token) en vez de construir más funcionalidad encima de ellas sin mencionarlas.

## Cuándo debe utilizarse

- Antes de agregar cualquier `action` nuevo manejado en `doGet(e)`/`doPost(e)` (`CODE-APPS-SCRIPT-FINAL.gs:102, 138`), especialmente si es una "ruta pública" (fuera del bloque que exige `requireAuthorized_`).
- Antes de agregar o modificar cualquier lógica de contraseñas, tokens de sesión, o tokens de un solo uso.
- Antes de agregar una acción sensible nueva (borrar datos, exportar información, resetear algo) sin verificar qué rol puede ejecutarla.
- Antes de agregar un rol nuevo o diferenciar permisos entre tipos de staff.
- Cuando se discuta cualquier vector de acceso no autenticado (enlaces enviados por correo, formularios públicos).

## Instrucciones detalladas

### 1. Contraseñas en texto plano — no agregar más

La pestaña `UsuariosPQRS` tiene una columna `Clave` que almacena contraseñas **en texto plano** (comparación directa `found.clave !== String(clave || '')` en `login_`, `CODE-APPS-SCRIPT-FINAL.gs:1115`). Además, las 3 cuentas de staff por defecto están **commiteadas en texto plano directamente en el código fuente** (`inicializarSistema()`, líneas 1417-1421):

```js
const defaultUsers = [
  ['soporte@colegiogoyavier.edu.co',    'Soporte PQRS',         'ACTIVO', 'Soporte2026*'],
  ['secretaria@colegiogoyavier.edu.co', 'Secretaría Académica', 'ACTIVO', 'Secretaria2026*'],
  ['rectoria@colegiogoyavier.edu.co',   'Rectoría',             'ACTIVO', 'Rectoria2026*']
];
```

Este es un problema de seguridad ya existente y aceptado como deuda conocida — **no lo repliques ni lo agraves**:
- No agregar contraseñas ni secretos nuevos hardcodeados en el código fuente (`.gs` o `.html`), bajo ninguna circunstancia, ni siquiera "temporalmente" o "solo para pruebas".
- Si se agrega una cuenta de staff nueva, no seguir el patrón de contraseña commiteada — usar un mecanismo fuera del código fuente (configurar la clave directamente en la hoja `UsuariosPQRS` después del despliegue, nunca en el `.gs`).
- Si la tarea lo permite razonablemente, considerar (y señalar como recomendación, no como cambio no solicitado) migrar a hash (ej. `Utilities.computeDigest` con salt) en vez de comparación de texto plano — pero esto es un cambio de diseño que requiere confirmación explícita antes de implementarse, no algo para colar sin que se pida.

### 2. Un único rol `'Staff'` — no asumir permisos que no existen

Tanto `login_` (línea 1119) como `googleLogin_` (línea 1175) hardcodean `role: 'Staff'` para CUALQUIER cuenta autenticada. No existe distinción admin/agente/lectura-solamente. Consecuencia real: cualquier usuario Staff autenticado puede ejecutar cualquier acción del sistema, incluyendo `resetData()` (`PQRS-FINAL.html:4141-4149`), que borra todos los datos y está protegida únicamente por un `confirm()` de navegador (trivial de saltarse o de aceptar por error).

**Regla operativa**: si se agrega una acción sensible nueva (borrar, exportar masivo, cambiar configuración global, resetear algo), no asumir que existe un mecanismo de autorización más fino que "¿tiene sesión de Staff válida?" — porque no existe. Si la acción es lo bastante sensible como para requerir diferenciación de permisos, eso es un cambio de diseño (introducir roles/permisos granulares) que debe señalarse explícitamente como tal y confirmarse antes de implementar, no improvisarse a medias (ej. no agregar un chequeo de rol que en la práctica siempre pasa porque todos son `'Staff'`).

### 3. El endpoint público `responderArea` — brecha IDOR real, no repetir el patrón

Comparar los dos enlaces públicos que reciben los ciudadanos/áreas por correo, ambos servidos sin pasar por `requireAuthorized_` (ver el bloque de "Rutas públicas" en `doGet`, líneas 116-120):

- **Enlace de respuesta del solicitante** (`?action=responder&id=...&tkn=...`, construido en línea 434): el parámetro `tkn` es un secreto real de un solo uso (columna dinámica `TokenRespuesta`, emitido/invalidado por `_actualizarTokenRespuesta_`, líneas 395-416) — se invalida al usarse. Este es el patrón CORRECTO.
- **Enlace de respuesta de ÁREA** (`?action=responderArea&id=...&area=...`, construido en línea 1247): **NO tiene ningún token ni secreto** — solo un `ID` secuencial predecible (formato `PQRS2260NNNN`) y el nombre de un departamento conocido (de la lista fija de 12 dependencias). Cualquiera que adivine o enumere un ID (trivial, es secuencial) puede enviar una "respuesta de área" para esa solicitud sin ninguna autorización real. Esto es una brecha IDOR (Insecure Direct Object Reference) comprobada, no teórica.

**Regla operativa**: 
1. **Nunca** agregar un endpoint público nuevo (fuera de `requireAuthorized_`) que se identifique solo por un ID predecible/secuencial sin acompañarlo de un token de un solo uso real, generado y validado igual que `TokenRespuesta`/`_actualizarTokenRespuesta_`.
2. Si la tarea toca `serveFormRespuestaArea_` o `guardarRespuestaArea_`/`guardarRespuestaAreaJson_`, es el momento natural de señalar esta brecha explícitamente y, si el alcance lo permite, proponer cerrarla añadiendo un token de área análogo a `TokenRespuesta` (nueva columna, ej. `TokenArea`, emitido junto con el envío a la dependencia y validado en `serveFormRespuestaArea_` antes de aceptar la respuesta).
3. No hay que "arreglar todo" en una tarea no relacionada, pero tampoco se debe construir funcionalidad nueva ENCIMA de `responderArea` (por ejemplo, agregar más datos sensibles a esa URL) sin mencionar que la ruta ya es insegura.

### 4. El token de sesión va como parámetro de query string

El patrón de autenticación (`requireAuthorized_(token)`, línea 152) recibe el token como parámetro de query string en cada llamada (`e.parameter.token` en `doGet`, `payload.token` en el body JSON de `doPost`). Los tokens en la URL de un `doGet` quedan expuestos en:
- Logs del servidor (Apps Script, proxies intermedios).
- Historial del navegador.
- Cualquier referrer header si se navega a un enlace externo desde una página que incluya el token en su URL.

**Regla operativa**: no es viable eliminar esto sin rediseñar el transporte (Apps Script `doGet`/`doPost` vía `google.script.run` o headers custom no son triviales de introducir en este modelo de despliegue) — pero cualquier código nuevo debe, como mínimo, evitar agregar el token a la URL en más lugares de los estrictamente necesarios (por ejemplo, no loguear la URL completa con el token en `console.log`, no incluirlo en mensajes de error mostrados al usuario, no compartir enlaces con el token embebido).

## Reglas obligatorias

1. Nunca agregar contraseñas, tokens de servicio, ni ningún secreto nuevo hardcodeado en `CODE-APPS-SCRIPT-FINAL.gs` o `PQRS-FINAL.html`.
2. Nunca asumir que existe distinción de permisos entre cuentas de Staff — hoy es un único rol; cualquier acción sensible nueva debe evaluarse contra ese hecho, no contra un modelo de permisos imaginario.
3. Nunca agregar un endpoint público nuevo identificado solo por un ID predecible sin un token de un solo uso real acompañándolo.
4. Cualquier cambio que toque `responderArea`/`serveFormRespuestaArea_`/`guardarRespuestaArea_` debe señalar explícitamente la brecha IDOR conocida, aunque no se resuelva en esa misma tarea.
5. No propagar el token de sesión a más superficies de las estrictamente necesarias (logs, mensajes de error, URLs compartidas).
6. Cualquier cambio de fondo al esquema de autenticación/autorización (hashing de contraseñas, roles granulares, tokens para `responderArea`) requiere confirmación explícita antes de implementarse — no es una decisión a tomar unilateralmente dentro de una tarea de alcance distinto.

## Criterios de validación

- ¿El cambio agrega algún secreto (contraseña, API key, token fijo) directamente en el código fuente? Si sí, rechazar y proponer alternativa fuera del código.
- ¿El cambio agrega una acción sensible nueva? Si sí, ¿se verificó que hoy cualquier Staff autenticado podría ejecutarla, y se documentó esa realidad en vez de asumir un control de permisos que no existe?
- ¿El cambio agrega un endpoint público nuevo (fuera de `requireAuthorized_`)? Si sí, ¿usa un token de un solo uso real (como `TokenRespuesta`) en vez de depender solo de un ID?
- ¿El cambio toca `responderArea` o funciones relacionadas? Si sí, ¿se mencionó explícitamente la brecha IDOR conocida?
- ¿El cambio expone el token de sesión en un lugar nuevo (logs, mensajes de error, URLs compartidas)? Si sí, evitarlo.

## Checklist final

- [ ] No se agregó ningún secreto nuevo hardcodeado en el código fuente.
- [ ] Ninguna acción sensible nueva asume permisos diferenciados que no existen hoy (rol único `Staff`).
- [ ] Ningún endpoint público nuevo depende solo de un ID predecible — todos usan un token de un solo uso real.
- [ ] Si se tocó `responderArea` o funciones relacionadas, se señaló explícitamente la brecha IDOR conocida (y se propuso cerrarla si el alcance lo permitía).
- [ ] El token de sesión no se expuso en un lugar nuevo (logs, errores, URLs compartidas).
- [ ] Cualquier cambio de fondo a autenticación/autorización/roles fue señalado como decisión de diseño mayor, no implementado unilateralmente.
