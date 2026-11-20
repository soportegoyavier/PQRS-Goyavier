# Puesta en marcha: perfiles, tipo de solicitante y formulario nuevo

Versión 3.1 · 2026-11-19. El sistema nuevo **funciona también con el formulario viejo** (los colaboradores que
hoy eligen «Colaborador» como grado se reconocen solos), así que se puede cambiar primero el sistema y luego el formulario, sin prisa.

## A. Sistema (Apps Script y hoja «PQRS Goyavier»)

1. **Copia de seguridad:** en el Sheets, *Archivo → Hacer una copia*.
2. En *Extensiones → Apps Script*:
   - Reemplace el contenido de `CODE-APPS-SCRIPT-FINAL.gs` por el nuevo.
   - Reemplace el archivo `PQRS-FINAL` (HTML) por el nuevo `PQRS-FINAL.html` (si la pantalla se sigue sirviendo desde Apps Script).
3. Ejecute **`actualizarEstructura()`** (Apps Script → seleccionar la función → Ejecutar → autorizar). Es seguro repetirla.
   Agrega las columnas nuevas **al final** (no mueve ni borra nada) y escribe en el registro quiénes aún no tienen perfil. También completa el tipo de solicitante de las solicitudes antiguas con la columna «¿Cuál es tu relación con el colegio?» de la hoja de respuestas (si la tienen llena; solo donde el tipo estaba vacío). Esa columna puede estar en cualquier posición de la hoja de respuestas: el sistema lee por título, no por posición.
4. En la hoja **UsuariosPQRS**, columna **Perfil** (valores exactos):

   | Usuario | Perfil | Qué ve |
   |---|---|---|
   | Secretaría Académica | `Secretaria` | Padres de familia y estudiantes |
   | Talento Humano (usuario nuevo: Email, Nombre, `ACTIVO`, Clave) | `Talento Humano` | Colaboradores, proveedores/contratistas y visitantes |
   | Rectoría | `Rectoria` | Todo |
   | Soporte PQRS | `Rectoria` | Todo |

   Quien no tenga perfil **no puede entrar** (el sistema avisa).
5. **Implementar → Administrar implementaciones → ✏️ (la actual) → Versión: «Nueva versión» → Implementar.**
   ⚠ No use «Nueva implementación»: cambiaría la URL y los enlaces que ya se enviaron por correo dejarían de ser los vigentes.
6. `actualizarEstructura()` ya deja cargados los correos de Talento Humano (`talentohumano@colegiogoyavier.edu.co`) y Rectoría (`rectoria@colegiogoyavier.edu.co`). Revíselos en **Configuración → Avisos por perfil**. Cada aviso va al correo de su bandeja; **Rectoría recibe copia solo cuando llega una solicitud nueva** (casilla apagable).
7. Compruebe en *Activadores* que sigue el de **«Al enviar formulario»**.

Quienes tengan el sistema abierto deberán volver a iniciar sesión (las sesiones anteriores no traen perfil).

## B. Formulario de Google (se edita el mismo, para no cambiar el enlace ni el QR)

Estructura en **3 secciones**:

**Sección 1 — Datos de contacto** (con el título y la descripción actuales)
1. **¿Cuál es tu relación con el colegio?** — *Opción múltiple, obligatoria.* Opciones, exactamente así:
   `Padre de familia` · `Estudiante` · `Colaborador` · `Proveedor o contratista` · `Visitante`
   Active **⋮ → «Ir a la sección según la respuesta»**: Padre de familia → *Sección 2*; Estudiante → *Sección 2*; Colaborador → *Sección 3*; Proveedor o contratista → *Sección 3*; Visitante → *Sección 3*.
2. Nombre completo *
3. Correo electrónico donde recibirás respuesta y seguimiento de tu PQRS *
4. Teléfono *

**Sección 2 — Datos del estudiante** (solo la ven padres de familia y estudiantes). Al final: «Ir a la siguiente sección».
5. Nombre del estudiante *  (ahora obligatoria)
6. Grado *  (**quitar «Colaborador»** de la lista)

**Sección 3 — Tu solicitud**
7. Tipo de solicitud *
8. Requiere respuesta *
9. Descripción de la solicitud *

Cuidados:
- **No elimine y vuelva a crear** las preguntas que ya existen: edítelas. Así se conserva el vínculo con la hoja y las respuestas anteriores.
- La pregunta nueva debe llamarse **«¿Cuál es tu relación con el colegio?»** (el sistema también reconoce «Tipo de solicitante» o «Relación con el colegio»). En la hoja «Respuestas de formulario 1» aparecerá una columna nueva al final: es normal.
- Después de editar, envíe **una respuesta de prueba por cada tipo** y verifique que cada una aparece solo en la bandeja correcta.

## C. Pantalla del personal en Vercel (opcional)

Solo cambia **el enlace de acceso del personal**. No cambian: los enlaces que reciben solicitantes y áreas por correo (siguen siendo de Apps Script), el enlace ni el QR del formulario, ni la hoja.

1. En vercel.com: *Add New → Project* → importe el repositorio **PQRS**. Framework: **Other**. `vercel.json` ya indica qué publicar (solo la pantalla, como `index.html`; no se publican el `.gs`, las pruebas ni la documentación).
2. *Deploy* → queda en `https://<proyecto>.vercel.app`. (Dominio propio opcional: *Settings → Domains* y el registro CNAME en el DNS del colegio.)
3. **Google Cloud Console → Credenciales → ID de cliente OAuth 2.0 → «Orígenes autorizados de JavaScript» → agregue la URL de Vercel** (y el dominio propio). Sin esto «Continuar con Google» falla con *origin_mismatch*. Puede tardar unos minutos en aplicar.
4. Pruebe: iniciar sesión, ver solicitudes, guardar un cambio.
5. (Opcional) En Apps Script ponga `const URL_APP = 'https://...';` y publique **Nueva versión**: el enlace de acceso antiguo mostrará un botón a la nueva dirección.
6. Avise al personal del nuevo enlace.

Desde entonces: la pantalla se actualiza con `git push`; el backend se sigue pegando en Apps Script (+ «Nueva versión»).
Si publica en Vercel ya no hace falta pegar `PQRS-FINAL.html` en Apps Script (déjelo mientras `URL_APP` esté vacío).

## D. Para quien mantenga el código

- `CODE-APPS-SCRIPT-FINAL.gs` es la **única fuente** del backend. Tras editarlo: `python sincronizar_script_embebido.py` (regenera la copia del botón «Ver Script»), `python sincronizar_script_embebido.py --check` y las pruebas de `pruebas/`.
- Las hojas se leen y escriben por **nombre de columna**, nunca por posición.
