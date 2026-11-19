# PQRS-Goyavier

Sistema PQRSF (Petición/Queja/Reclamo/Felicitación/Sugerencia) de intake y seguimiento para la
Secretaría Académica del Colegio Goyavier Campestre (Colombia).

## Stack real

**Google Apps Script + Google Sheets. NO Supabase, NO Postgres, NO npm/build.** El repositorio son
3 archivos: `PQRS-FINAL.html` (cliente completo HTML+CSS+JS en un solo archivo),
`CODE-APPS-SCRIPT-FINAL.gs` (backend real de Apps Script), y `logo_goyavier.png` (más las herramientas de abajo: `sincronizar_script_embebido.py`, `pruebas/`, `vercel.json`). La "base de datos"
son 5 pestañas de una hoja de Google Sheets (`PQRS`, `Respuestas de formulario 1`, `Seguimientos`,
`Configuracion`, `UsuariosPQRS`). Se despliega vía `doGet`/`doPost` y `HtmlService`. No asumir ni
introducir un backend gestionado distinto a este sin que sea una decisión explícita y confirmada.

## Skills obligatorias

Antes de finalizar cualquier cambio relevante en este repositorio, Claude debe aplicar
automáticamente las skills en `.claude/skills/` que correspondan a lo tocado. Su contenido
especializado (con líneas de código, nombres de funciones/columnas reales y reglas concretas)
prevalece sobre cualquier suposición general — este archivo solo referencia, no duplica ese detalle.

1. **`architecture-guardian`** — protege la arquitectura de 2 archivos sin build y la reutilización
   de helpers de UI existentes (badges, modales, barra de filtros).
2. **`regression-guardian`** — previene drift entre `CODE-APPS-SCRIPT-FINAL.gs` y su copia embebida
   `APPS_SCRIPT_CODE`, inconsistencias del prefijo de ID `PQRS2260`, y fallos silenciosos de `no-cors`.
3. **`data-layer-guardian`** — trata Google Sheets como la base de datos real (esquema en
   `getHeaders()`, semántica clear-and-rewrite de `syncData()`, riesgo de concurrencia).
4. **`ui-guardian`** — exige sanitización de HTML en cualquier `innerHTML` nuevo con datos de
   solicitantes/ciudadanos/áreas (no existe función de escape hoy — brecha XSS conocida).
5. **`security-guardian`** — cubre contraseñas en texto plano, rol único `Staff` sin permisos
   granulares, y el endpoint público `responderArea` sin token real (brecha IDOR conocida).
6. **`business-logic-guardian`** — protege la máquina de estados
   (`Borrador→Abierto→Proceso→Cerrado/Apelado`), el cálculo de SLA (`addBusinessDays`/
   `diasRespuesta`/`alertaDias`), la línea de tiempo de seguimientos, y el envío de correo vía Gmail.
7. **`pqrs-goyavier-guardian`** — fija la identidad general del proyecto: stack real, entidades
   PQRSF propias del colegio, modelo de acceso (rol único, ciudadanos sin login) y el caso de
   drift ya real entre los 2 archivos fuente.

## Perfiles, bandejas y herramientas (v3.1 · 2026-11-19)

- **Tres perfiles** (columna `Perfil` de `UsuariosPQRS`): `Secretaria` (ve padres de familia y estudiantes), `Talento Humano` (colaboradores, proveedores/contratistas y visitantes) y `Rectoria` (todo). Cada solicitud tiene `TipoSolicitante` (lo elige quien llena el formulario) y de ahí sale su bandeja. El filtro vive **en el servidor** (`getData`, `syncData`, `enviarObsArea_`). Ya no existe el rol único `Staff`.
- Solo «Padre de familia» y «Estudiante» llevan `Estudiante` y `Grado`.
- `syncData` ya **no** reescribe la hoja completa: actualiza fila por fila, bajo candado, y solo borra lo que el cliente pide en `eliminados`.
- Las hojas se leen y escriben **por nombre de columna**, nunca por posición.
- Tras tocar `CODE-APPS-SCRIPT-FINAL.gs`: `python sincronizar_script_embebido.py` y luego `--check`; y correr `pruebas/` (ver `pruebas/README.md`). Nunca editar a mano `APPS_SCRIPT_CODE`.
- Puesta en marcha y Vercel: `PASOS-DE-DESPLIEGUE.md`.

