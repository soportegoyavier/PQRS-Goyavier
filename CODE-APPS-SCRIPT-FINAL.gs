// ============================================================
// PQRS Goyavier - Google Apps Script v3.0
// Pegue este código en Extensiones > Apps Script
// Implemente como: Aplicacion web, ejecutar como "Yo"
// y acceso: Cualquier persona con el enlace.
// ============================================================

// Almacena el nombre del callback JSONP por ejecución (solo aplica en doGet)
let _jsonpCb_ = '';

const SHEET_NAME    = 'PQRS';
const FORMS_SHEET   = 'Respuestas de formulario 1';
const SEG_SHEET     = 'Seguimientos';
const CFG_SHEET     = 'Configuracion';
const USUARIOS_SHEET = 'UsuariosPQRS';
// EMAIL_RESP: destinatario de notificaciones internas del sistema (no depende del usuario logueado)
const EMAIL_RESP    = 'secretaria@colegiogoyavier.edu.co';
// Si la pantalla del personal se publica en otro sitio (p. ej. Vercel), escriba aquí su dirección
// (https://...). El enlace de acceso anterior —esta URL de Apps Script sin parámetros— mostrará un aviso
// con un botón a la nueva dirección. Los enlaces que reciben solicitantes y áreas por correo NO cambian:
// siguen siendo de Apps Script. Vacío = Apps Script sirve la pantalla (comportamiento anterior).
const URL_APP       = '';

// Escapa caracteres HTML para evitar XSS al insertar datos de Sheets en HTML generado.
function sanitizeHtml_(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
//  PERFILES, BANDEJAS Y TIPO DE SOLICITANTE
// ============================================================
// Cada usuario de la hoja UsuariosPQRS tiene un «Perfil»:
//   Secretaria · Talento Humano · Rectoria
// Cada solicitud pertenece a UNA bandeja según QUIÉN la presenta (columna TipoSolicitante):
//   Padre de familia, Estudiante                      → bandeja «secretaria»
//   Colaborador, Proveedor o contratista, Visitante   → bandeja «talento»
// Secretaría ve solo su bandeja, Talento Humano solo la suya y Rectoría ve todo.
// El filtro se aplica en el SERVIDOR (getData / syncData / enviarObsArea_): el navegador nunca
// recibe ni puede modificar filas de una bandeja que su perfil no ve.
const PERFIL_SECRETARIA  = 'Secretaria';
const PERFIL_TALENTO     = 'Talento Humano';
const PERFIL_RECTORIA    = 'Rectoria';
const BANDEJA_SECRETARIA = 'secretaria';
const BANDEJA_TALENTO    = 'talento';
const NOMBRE_BANDEJA     = { secretaria: 'Secretaría Académica', talento: 'Talento Humano' };
const TIPOS_SOLICITANTE  = ['Padre de familia', 'Estudiante', 'Colaborador', 'Proveedor o contratista', 'Visitante'];
const TIPOS_CON_ESTUDIANTE = ['Padre de familia', 'Estudiante'];
// Posibles títulos de la pregunta «quién eres» en el Google Form (se comparan sin tildes ni signos).
const CAMPOS_TIPO_SOLICITANTE = [
  '¿Cuál es tu relación con el colegio?', 'Relación con el colegio', 'Tipo de solicitante',
  'Soy', '¿Quién eres?', 'Quién eres', 'Eres', 'Rol'
];
// Si el título de la pregunta se cambió un poco, basta con que contenga alguna de estas frases.
const CLAVES_PARCIALES_SOLICITANTE = ['relacion con el colegio', 'tipo de solicitante', 'quien eres'];
const SEG_HEADERS = ['PQRS_ID','Fecha','Respuesta','Estado','RegistradoEn','Tipo','Autor','SegKey'];

// Normaliza para comparar: sin tildes, minúsculas, sin signos, espacios simples.
function normKey_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function valorTexto_(v) {
  if (v === undefined || v === null) return '';
  return v instanceof Date ? v.toISOString() : String(v);
}

// Primer valor no vacío cuyo encabezado contenga alguna de las frases. pares = [[encabezado, valor], ...]
function valorParcial_(pares, parciales) {
  for (let i = 0; i < pares.length; i++) {
    const n = normKey_(pares[i][0]);
    const v = String(pares[i][1] == null ? '' : pares[i][1]).trim();
    if (v && parciales.some(function(p) { return n.indexOf(p) >= 0; })) return v;
  }
  return '';
}

// Bandeja de una solicitud ya guardada, buscándola por ID (para endpoints públicos que solo traen el ID).
function bandejaDePqrsId_(ss, id) {
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return BANDEJA_SECRETARIA;
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(function(h) { return String(h).trim(); });
  const iId = hdrs.indexOf('ID');
  const row = data.slice(1).find(function(r) { return String(r[iId]).trim() === id; });
  return row ? bandejaDeFilaArray_(hdrs, row) : BANDEJA_SECRETARIA;
}

function normPerfil_(v) {
  const n = normKey_(v);
  if (!n) return '';
  if (n.indexOf('rector') >= 0) return PERFIL_RECTORIA;
  if (n.indexOf('talento') >= 0 || n.indexOf('humano') >= 0 || n === 'th') return PERFIL_TALENTO;
  if (n.indexOf('secretar') >= 0) return PERFIL_SECRETARIA;
  return '';
}

// Devuelve el nombre canónico del tipo de solicitante, o '' si no se reconoce.
function normTipoSolicitante_(v) {
  const n = normKey_(v);
  if (!n) return '';
  if (/\b(padre|madre|acudiente|familia)\b/.test(n)) return 'Padre de familia';
  if (/\b(estudiante|alumno|alumna)\b/.test(n)) return 'Estudiante';
  if (/\b(colaborador|colaboradora|empleado|empleada|docente|profesor|profesora|trabajador|trabajadora)\b/.test(n)) return 'Colaborador';
  if (/\b(proveedor|proveedora|contratista)\b/.test(n)) return 'Proveedor o contratista';
  if (/\bvisitante\b/.test(n)) return 'Visitante';
  return '';
}

// Compatibilidad con el formulario anterior: ahí los colaboradores elegían «Colaborador» en la lista de Grado.
// Devuelve {tipo, estudiante, grado} ya limpios.
function normalizarSolicitante_(tipoRaw, estudiante, grado) {
  let tipo = normTipoSolicitante_(tipoRaw);
  let gr   = String(grado == null ? '' : grado).trim();
  const est = String(estudiante == null ? '' : estudiante).trim();
  const gradoEsMarcaVieja = normKey_(gr) === 'colaborador';          // «Colaborador» nunca es un grado
  if (!tipo) {
    if (gradoEsMarcaVieja) tipo = 'Colaborador';
    else tipo = String(tipoRaw == null ? '' : tipoRaw).trim();      // valor no reconocido: se conserva tal cual
  }
  if (gradoEsMarcaVieja) gr = '';                                    // también cuando el tipo ya se completó desde la hoja de respuestas
  return { tipo: tipo, estudiante: est, grado: gr };
}

function bandejaDeTipo_(tipo, grado) {
  const t = normTipoSolicitante_(tipo);
  if (t === 'Colaborador' || t === 'Proveedor o contratista' || t === 'Visitante') return BANDEJA_TALENTO;
  if (t === 'Padre de familia' || t === 'Estudiante') return BANDEJA_SECRETARIA;
  // Sin tipo (solicitudes anteriores al cambio): el formulario viejo ponía «Colaborador» como grado.
  if (normKey_(grado) === 'colaborador') return BANDEJA_TALENTO;
  return BANDEJA_SECRETARIA;
}

function perfilVeBandeja_(perfil, bandeja) {
  if (perfil === PERFIL_RECTORIA)   return true;
  if (perfil === PERFIL_SECRETARIA) return bandeja === BANDEJA_SECRETARIA;
  if (perfil === PERFIL_TALENTO)    return bandeja === BANDEJA_TALENTO;
  return false;
}

function bandejaDeFilaArray_(headers, row) {
  const iT = headers.indexOf('TipoSolicitante');
  const iG = headers.indexOf('Grado');
  return bandejaDeTipo_(iT >= 0 ? row[iT] : '', iG >= 0 ? row[iG] : '');
}

// Líneas «Estudiante / Grado» solo cuando hay datos de estudiante (los colaboradores, proveedores y visitantes no los tienen).
function lineasEstudiante_(estudiante, grado) {
  const e = String(estudiante || '').trim(), g = String(grado || '').trim();
  return (e ? 'Estudiante          : ' + e + '\n' : '') + (g ? 'Grado               : ' + g + '\n' : '');
}

// ── Correos por bandeja ──────────────────────────────────────
// Configuracion.emailPerfiles = {secretaria, talentoHumano, rectoria}; copiarRectoria (por defecto sí).
// Cada aviso va al correo de SU bandeja. Rectoría recibe copia ÚNICAMENTE cuando llega una solicitud nueva
// (no en observaciones, cierres ni respuestas de un área). Si falta el correo de una bandeja se usa
// EMAIL_RESP para que ninguna notificación se pierda.
function correoDeBandeja_(bandeja, cfg) {
  const ep = ((cfg || readConfigObject_()).emailPerfiles) || {};
  const v = String((bandeja === BANDEJA_TALENTO ? ep.talentoHumano : ep.secretaria) || '').trim();
  return v || EMAIL_RESP;
}

function destinatariosBandeja_(bandeja, conCopiaRectoria) {
  const cfg = readConfigObject_();
  const lista = [correoDeBandeja_(bandeja, cfg)];
  const rect = String(((cfg.emailPerfiles) || {}).rectoria || '').trim();
  if (conCopiaRectoria === true && rect && cfg.copiarRectoria !== false) lista.push(rect);
  return lista.filter(function(x, i) { return x && lista.indexOf(x) === i; }).join(',');
}

// conCopiaRectoria = true solo para el aviso de «solicitud nueva».
function notificarBandeja_(bandeja, asunto, cuerpo, conCopiaRectoria) {
  GmailApp.sendEmail(destinatariosBandeja_(bandeja, conCopiaRectoria), asunto, cuerpo, {name: 'PQRS Colegio Goyavier'});
}

// ── Candado: evita que dos personas (o un solicitante y el personal) escriban la hoja a la vez ──
function conBloqueo_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('El sistema está ocupado. Intente de nuevo en unos segundos.');
  try { return fn(); } finally { lock.releaseLock(); }
}

// Igual que conBloqueo_ pero para endpoints que responden JSON: si no hay turno, responde el error.
function conBloqueoJson_(fn) {
  try { return conBloqueo_(fn); } catch (err) { return jsonOut({ok: false, error: err.message}); }
}

// ── Encabezados por NOMBRE (nunca por posición) ──────────────
function getHeaders() {
  return ['ID','Fecha','Dependencia','Nombre',
    'Telefono','Correo','Estudiante','Grado','TipoSolicitud','MedioRecepcion',
    'RequiereRespuesta','Descripcion','Estado','EmailPendiente','CreadoEn','OrigenForms',
    'ObservacionSolicitante','FechaObservacion','FormsKey','Calificacion',
    'TipoSolicitante','TokenRespuesta'];
}

function estiloEncabezado_(range) {
  range.setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
}

// Garantiza que existan todas las columnas estándar. Las que falten se agregan AL FINAL; nunca se
// reordena, renombra ni borra una columna existente (así no se corrompen datos como TokenRespuesta).
// Devuelve los encabezados REALES de la hoja, en su orden real.
function asegurarEncabezados_(sheet, estandar) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(estandar);
    estiloEncabezado_(sheet.getRange(1, 1, 1, estandar.length));
    return estandar.slice();
  }
  const ancho = Math.max(sheet.getLastColumn(), 1);
  const act = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(function(h) { return String(h).trim(); });
  let fin = act.length;
  while (fin > 0 && !act[fin - 1]) fin--;
  const hdrs = act.slice(0, fin);
  const faltan = estandar.filter(function(h) { return hdrs.indexOf(h) < 0; });
  if (faltan.length) {
    estiloEncabezado_(sheet.getRange(1, hdrs.length + 1, 1, faltan.length).setValues([faltan]));
    faltan.forEach(function(h) { hdrs.push(h); });
  }
  return hdrs;
}

function ensureHeaders(sheet)       { return asegurarEncabezados_(sheet, getHeaders()); }
function ensureSegHeaders_(sheet)   { return asegurarEncabezados_(sheet, SEG_HEADERS); }

function mapaEncabezados_(hdrs) {
  const m = {};
  hdrs.forEach(function(h, i) { if (h && m[h] === undefined) m[h] = i; });
  return m;
}

// ── Consecutivo de ID (PQRS2260NNNN) ─────────────────────────
function numeroDeId_(id)  { return parseInt(String(id || '').replace('PQRS2260', ''), 10) || 0; }
function formatoId_(n)    { return 'PQRS2260' + String(n).padStart(4, '0'); }

function maxNumeroIdHoja_(sheet) {
  let max = 0;
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
      const n = numeroDeId_(String(r[0] || '').trim());
      if (n > max) max = n;
    });
  }
  return max;
}

function ultimoIdReservado_() {
  return parseInt(PropertiesService.getScriptProperties().getProperty('PQRS_ULTIMO_ID') || '0', 10) || 0;
}

// Reserva el siguiente consecutivo. DEBE llamarse con el candado tomado.
// Lleva un contador propio (PQRS_ULTIMO_ID) además del máximo de la hoja, porque cada perfil solo ve
// una parte de las solicitudes y no puede calcular el siguiente número por su cuenta.
function generarId(sheet) {
  const n = Math.max(maxNumeroIdHoja_(sheet), ultimoIdReservado_()) + 1;
  PropertiesService.getScriptProperties().setProperty('PQRS_ULTIMO_ID', String(n));
  return formatoId_(n);
}

// Endpoint autenticado: el cliente pide un consecutivo antes de crear una solicitud manual.
function reservarId_(auth) {
  return conBloqueoJson_(function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    ensureHeaders(sheet);
    return jsonOut({ok: true, id: generarId(sheet)});
  });
}

// ── Seguimientos: identidad estable de una fila para fusionar sin duplicar ──
function identidadSeg_(id, segKey, registradoEn, tipo, respuesta) {
  const k = valorTexto_(segKey).trim();
  return String(id || '').trim() + '|' +
    (k || (valorTexto_(registradoEn).trim() + '|' + String(tipo || '') + '|' + String(respuesta || '').slice(0, 60)));
}

// Sheets convierte las fechas escritas como texto en celdas de fecha; al leerlas vuelven como Date.
// Se comparan por su valor para no reescribir filas que no cambiaron.
function fechaIgual_(d, s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return false;
  if (t === d.toISOString()) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') === t;
  return false;
}

function celdaIgual_(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date) return fechaIgual_(a, b);
  if (b instanceof Date) return fechaIgual_(b, a);
  return valorTexto_(a).toLowerCase() === valorTexto_(b).toLowerCase();
}

function filaIgual_(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!celdaIgual_(a[i], b[i])) return false;
  return true;
}

function onFormSubmit(e) {
  try {
    if (!e || !e.namedValues) {
      Logger.log('onFormSubmit: evento no válido. Esta función debe ejecutarse mediante el activador "Al enviar formulario", no manualmente desde el editor.');
      return;
    }
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const r = e.namedValues;

    // Leer cabeceras reales de la hoja Forms para mapeo robusto de campos
    const formsSheet = ss.getSheetByName(FORMS_SHEET);
    const fHeaders = formsSheet && formsSheet.getLastRow() >= 1
      ? formsSheet.getRange(1, 1, 1, formsSheet.getLastColumn()).getValues()[0]
      : [];
    const fVals = e.values || [];

    // get(fallbackIdx, ...keys): 3 niveles — exacto en namedValues → normalizado en namedValues
    // → por header en hoja Forms → fallback por posición de columna (fallbackIdx; -1 = sin fallback).
    const get = (fallbackIdx, ...keys) => {
      for(const k of keys) { if(r[k] && r[k][0].trim()) return r[k][0].trim(); }
      for(const k of keys) {
        const nk = normKey_(k);
        for(const [rk, rv] of Object.entries(r)) {
          if(normKey_(rk) === nk && rv && rv[0].trim()) return rv[0].trim();
        }
      }
      return getFormValue_(fHeaders, fVals, keys, fallbackIdx);
    };

    const formTimestamp = e.values && e.values[0] instanceof Date ? e.values[0].toISOString() : new Date().toISOString();
    const fecha      = formTimestamp.slice(0, 10);
    // Índices de columna (solo como último recurso) coinciden con getData(): col A(0)=Timestamp, B(1)=Nombre,
    // C(2)=Correo, D(3)=Telefono, E(4)=Estudiante, F(5)=TipoSolicitud, G(6)=Requiere, H(7)=Descripcion, I(8)=Grado
    const nombre     = get(1, 'Nombre completo', 'Nombre', 'Nombres', 'Nombre del solicitante', 'Nombre y apellidos');
    const correo     = get(2, 'Correo electrónico donde recibirás respuesta y seguimiento de tu PQRS.', 'Correo electrónico', 'Correo electronico', 'Correo', 'Email', 'E-mail');
    const telefono   = get(3, 'Teléfono', 'Telefono', 'Celular', 'Móvil', 'Movil', 'Tel');
    const estudiante0 = get(4, 'Nombre del estudiante', 'Estudiante', 'Nombre estudiante', 'Nombre del hijo', 'Nombre del hijo/a');
    const tiposol    = get(5, 'Tipo de solicitud', 'Tipo de Solicitud', 'Tipo PQRS', 'Tipo', 'Categoría', 'Categoria');
    const requiere   = get(6, 'Requiere respuesta', 'Requiere Respuesta') || 'Si';
    const descripcion= get(7, 'Descripción de la solicitud', 'Descripcion de la solicitud', 'Descripción', 'Descripcion', 'Mensaje', 'Detalle', 'Detalle de la solicitud', 'Su solicitud');
    const grado0     = get(8, 'Grado', 'Grado del estudiante', 'Curso', 'Grado/Curso', 'Grado o curso');
    const solicitanteRaw = get(-1, ...CAMPOS_TIPO_SOLICITANTE) ||
      valorParcial_(Object.keys(r).map(function(k) { return [k, (r[k] && r[k][0]) || '']; }), CLAVES_PARCIALES_SOLICITANTE);
    const medio      = 'Forms';

    // Quién presenta la solicitud (y limpieza del formulario viejo, donde «Colaborador» venía como grado)
    const sol = normalizarSolicitante_(solicitanteRaw, estudiante0, grado0);
    const estudiante = sol.estudiante, grado = sol.grado;
    const bandeja = bandejaDeTipo_(sol.tipo, grado);

    // Generar un ID único estable (UUID) para esta fila del formulario
    const formsId = Utilities.getUuid();

    // Escribir el FormsID en la columna "FormsID" de la hoja de respuestas
    if (formsSheet && e.range) {
      let fIdCol = fHeaders.indexOf('FormsID');
      if (fIdCol < 0) {
        fIdCol = formsSheet.getLastColumn();
        formsSheet.getRange(1, fIdCol + 1)
          .setValue('FormsID')
          .setFontWeight('bold')
          .setBackground('#1575bc')
          .setFontColor('#ffffff');
      }
      formsSheet.getRange(e.range.getRow(), fIdCol + 1).setValue(formsId);
    }

    // ID consecutivo + fila nueva bajo candado (dos envíos simultáneos ya no pueden recibir el mismo ID)
    let id = '';
    conBloqueo_(function() {
      const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
      const hdrs = ensureHeaders(sheet);
      id = generarId(sheet);
      const map = {
        ID: id, Fecha: fecha, Dependencia: '',
        Nombre: nombre, Telefono: telefono, Correo: correo,
        Estudiante: estudiante, Grado: grado, TipoSolicitud: tiposol,
        MedioRecepcion: medio, RequiereRespuesta: requiere,
        Descripcion: descripcion, Estado: 'Borrador',
        EmailPendiente: 'FALSE', CreadoEn: formTimestamp,
        OrigenForms: 'TRUE', FormsKey: formsId, TipoSolicitante: sol.tipo
      };
      sheet.appendRow(hdrs.map(function(h) { return map[h] !== undefined ? map[h] : ''; }));
    });

    const asunto = '[PQRS Goyavier] Nueva solicitud desde Forms · ' + id + ' · ' + (NOMBRE_BANDEJA[bandeja] || '');
    const cuerpo = 'Nueva solicitud PQRS desde el formulario web.\n\nBandeja: ' + NOMBRE_BANDEJA[bandeja] +
      '\n\nID: ' + id + '\nFecha: ' + fecha + '\nSolicitante: ' + (sol.tipo || '-') + '\nTipo: ' + tiposol +
      '\nNombre: ' + nombre + '\n' + lineasEstudiante_(estudiante, grado).replace(/ +:/g, ':') +
      'Descripción: ' + descripcion;
    notificarBandeja_(bandeja, asunto, cuerpo, true);       // solicitud nueva: también copia a Rectoría

    // Enviar confirmación de recibo al solicitante
    if (correo) {
      try {
        const asuntoSolic = '[Colegio Goyavier] Recibimos tu solicitud PQRS · ' + id;
        const cuerpoSolic =
          'Hola, ' + nombre + '.\n\n' +
          'Hemos recibido correctamente tu solicitud PQRS. A continuación el detalle de tu radicado:\n\n' +
          'Número de solicitud : ' + id + '\n' +
          'Fecha               : ' + fecha + '\n' +
          'Tipo de solicitud   : ' + tiposol + '\n' +
          lineasEstudiante_(estudiante, grado) + '\n' +
          'Descripción:\n' + descripcion + '\n\n' +
          'Nuestro equipo revisará tu solicitud y te contactará a la brevedad. ' +
          'Cuando tengamos una respuesta oficial, te la haremos llegar a este mismo correo.\n\n' +
          'Gracias por confiar en el Colegio Goyavier Campestre.\n\n' +
          'Con atención,\nEquipo PQRS · Colegio Goyavier Campestre';
        GmailApp.sendEmail(correo, asuntoSolic, cuerpoSolic, {name: 'PQRS Colegio Goyavier', replyTo: correoDeBandeja_(bandeja)});
      } catch(mailSolicErr) {
        Logger.log('Error correo confirmación solicitante: ' + mailSolicErr.message);
      }
    }
  } catch(err) {
    Logger.log('Error onFormSubmit: ' + err.message);
  }
}

function doGet(e) {
  const rawCb = e.parameter.callback || '';
  _jsonpCb_ = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(rawCb) ? rawCb : '';
  try {
    const action = e.parameter.action;
    // Sin parámetro action → servir la interfaz principal
    if (!action) {
      if (/^https:\/\//.test(URL_APP)) return paginaNuevaDireccion_();
      return HtmlService.createHtmlOutputFromFile('PQRS-FINAL')
        .setTitle('Sistema PQRS · Goyavier Campestre')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
    }
    if (action === 'ping')        return jsonOut('ok');
    if (action === 'login')       return login_(e.parameter.usuario, e.parameter.clave);
    if (action === 'logout')      return logout_(e.parameter.token);
    // Autenticación con Google — valida access_token con userinfo API (igual que Zaiko)
    if (action === 'googleLogin') return googleLogin_(e.parameter.access_token);
    // Rutas públicas — sin autenticación (para solicitantes externos)
    if (action === 'responder')             return serveFormRespuesta_(e.parameter);
    if (action === 'guardarRespuesta')      return guardarRespuestaSolicitante_(e.parameter);
    if (action === 'responderArea')         return serveFormRespuestaArea_(e.parameter);
    if (action === 'guardarRespuestaArea')  return guardarRespuestaArea_(e.parameter);
    // Rutas públicas JSON (para fetch desde formularios de respuesta públicos). Escriben en la hoja,
    // así que toman el mismo candado que el guardado del personal.
    if (action === 'guardarRespuestaJson')     return conBloqueoJson_(function() { return guardarRespuestaSolicitanteJson_(e.parameter); });
    if (action === 'guardarRespuestaAreaJson') return conBloqueoJson_(function() { return guardarRespuestaAreaJson_(e.parameter); });
    if (action === 'cerrarPqrsJson')           return conBloqueoJson_(function() { return cerrarPqrsSolicitanteJson_(e.parameter); });
    const auth = requireAuthorized_(e.parameter.token);
    if (!auth.ok) return jsonOut(auth);
    if (action === 'getData')        return getData(auth);
    if (action === 'nextId')         return reservarId_(auth);
    if (action === 'getConfig')      return getConfig();
    if (action === 'sendEmail')      return sendEmailFromParams_(e.parameter);
    if (action === 'enviarObsArea')  return enviarObsArea_(e.parameter, auth);
    if (action === 'markFormsRow')   return markFormsRow(e.parameter.timestamp);
    return jsonOut({ok: true, msg: 'PQRS Goyavier API activa'});
  } catch(err) {
    return jsonOut({ok: false, error: 'Error GAS: ' + err.message});
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const auth = requireAuthorized_(payload.token);
    if (!auth.ok) return jsonOut(auth);
    if (payload.action === 'sync')          return syncData(payload.data, auth, payload.eliminados);
    if (payload.action === 'saveConfig')    return saveConfig(payload.config);
    if (payload.action === 'markFormsRow')  return markFormsRow(payload.timestamp);
    if (payload.action === 'sendResponseEmail') return sendResponseEmail(payload.solicitud, payload.seguimiento);
  } catch(err) {
    return jsonOut({error: err.message});
  }
}

// Aviso del enlace de acceso antiguo cuando la pantalla vive en otro sitio. Es un enlace (no una
// redirección automática) porque Apps Script muestra sus páginas dentro de un marco protegido.
function paginaNuevaDireccion_() {
  const url = sanitizeHtml_(URL_APP);
  const html =
    '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
    '<title>Sistema PQRS · Goyavier Campestre</title><style>' +
    'body{font-family:Segoe UI,sans-serif;background:linear-gradient(145deg,#073f6e 0%,#0d5a96 55%,#1575bc 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;padding:24px}' +
    '.c{background:#fff;border-radius:14px;max-width:420px;padding:36px 28px;text-align:center;box-shadow:0 16px 48px rgba(7,63,110,.35)}' +
    'h2{color:#0d5a96;font-size:20px;margin:0 0 10px}p{color:#4a5568;font-size:14px;line-height:1.7;margin:0}' +
    'a{display:inline-block;margin-top:18px;background:#0d5a96;color:#fff;text-decoration:none;font-weight:700;border-radius:8px;padding:12px 22px}' +
    '</style></head><body><div class="c"><h2>El sistema PQRS tiene una nueva dirección</h2>' +
    '<p>Ingrese desde el siguiente botón y guarde la nueva dirección en sus favoritos.</p>' +
    '<a href="' + url + '" target="_top" rel="noopener">Abrir el sistema PQRS</a></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Sistema PQRS · Goyavier Campestre')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

// Valida el token de sesión y devuelve el perfil. Una sesión emitida antes de existir los perfiles
// (sin «perfil» guardado) se rechaza: obliga a iniciar sesión de nuevo y así recibe su perfil.
function requireAuthorized_(token) {
  if (!token) return {ok: false, authorized: false, error: 'Sesión no iniciada.'};
  const raw = CacheService.getScriptCache().get('pqrs_token_' + token);
  if (!raw) return {ok: false, authorized: false, error: 'Sesión vencida. Inicie sesión nuevamente con Google.'};
  const data = JSON.parse(raw);
  const perfil = normPerfil_(data.perfil);
  if (!perfil) return {ok: false, authorized: false, error: 'Su sesión no tiene un perfil asignado. Cierre sesión e ingrese de nuevo.'};
  return {ok: true, authorized: true, usuario: data.usuario, email: data.email, nombre: data.nombre, role: perfil, perfil: perfil};
}

function readConfigObject_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CFG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {};
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const cfg = {};
  data.forEach(([k, v]) => {
    if(!k) return;
    try { cfg[k] = JSON.parse(v); } catch(e) { cfg[k] = v; }
  });
  return cfg;
}

function getConfig() {
  return jsonOut(readConfigObject_());
}

function saveConfig(config) {
  if(!config) return jsonOut({error: 'No config received'});
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG_SHEET);
  if(!sheet) {
    sheet = ss.insertSheet(CFG_SHEET);
    sheet.appendRow(['Clave', 'Valor']);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
  }
  if(sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
  const toSave = Object.entries(config).filter(([k]) => k !== 'scriptUrl');
  toSave.forEach(([k, v], i) => {
    sheet.getRange(i + 2, 1, 1, 2).setValues([[k, JSON.stringify(v)]]);
  });
  return jsonOut({ok: true});
}

function filaAObjeto_(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) {
    if (!h || h === 'TokenRespuesta') return;          // el token de respuesta es un secreto del servidor
    const val = row[i];
    if (h === 'OrigenForms' || h === 'EmailPendiente') {
      const v = String(val);
      obj[h] = (v === 'TRUE' || v === 'true' || v === '1') ? 'TRUE' : 'FALSE';
    } else {
      obj[h] = valorTexto_(val);
    }
  });
  return obj;
}

// Devuelve SOLO las solicitudes que el perfil de la sesión puede ver (ver «PERFILES, BANDEJAS…»).
// Los IDs de las filas nuevas del Forms se asignan con TODAS las solicitudes a la vista y recién después
// se filtra, para que todos los perfiles vean los mismos IDs.
function getData(auth) {
  const perfil = auth && auth.perfil;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pqrsSheet = ss.getSheetByName(SHEET_NAME);
  let pqrsRows = [];
  if (pqrsSheet && pqrsSheet.getLastRow() >= 2) {
    const data = pqrsSheet.getDataRange().getValues();
    const headers = data[0].map(function(h) { return String(h).trim(); });
    pqrsRows = data.slice(1).filter(r => r[0]).map(row => filaAObjeto_(headers, row));
  }

  // Leer seguimientos y construir mapa por ID de PQRS
  const segSheet = ss.getSheetByName(SEG_SHEET);
  const segMap = {};
  if (segSheet && segSheet.getLastRow() >= 2) {
    const segData = segSheet.getDataRange().getValues();
    segData.slice(1).filter(r => r[0]).forEach(row => {
      const pqrsId = String(row[0]).trim();
      const fechaSeg = row[1] instanceof Date
        ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(row[1] || '');
      const seg = {
        fecha: fechaSeg,
        respuesta: String(row[2] || ''),
        estado: String(row[3] || ''),
        registradoEn: valorTexto_(row[4]),
        tipo: String(row[5] || 'secretaria'),
        autor: String(row[6] || ''),
        segKey: valorTexto_(row[7])
      };
      if (!segMap[pqrsId]) segMap[pqrsId] = [];
      segMap[pqrsId].push(seg);
    });
  }

  const formsSheet = ss.getSheetByName(FORMS_SHEET);
  if (formsSheet && formsSheet.getLastRow() >= 2) {
    const formsData = formsSheet.getDataRange().getValues();
    const formsHeaders = formsData[0];
    // Columnas de control añadidas por la app en la hoja de Forms
    const formsIdCol  = formsHeaders.indexOf('FormsID');   // UUID estable por fila
    const revisadoCol = formsHeaders.indexOf('Revisado');  // marcador de ya importado
    const formsRows = formsData.slice(1).filter(r => r[0]);

    // Claves ya procesadas: FormsKey guardado en la hoja PQRS (UUID o timestamp)
    const processedFormsKeys = new Set(pqrsRows.map(r => r.FormsKey || '').filter(Boolean));
    // Fallback para entradas antiguas sin FormsKey: comparar por CreadoEn
    const processedTs = new Set(
      pqrsRows.filter(r => !r.FormsKey).map(r => normalizeTimestamp_(r.CreadoEn)).filter(Boolean)
    );

    formsRows.forEach(row => {
      const ts    = row[0];
      const tsStr = normalizeTimestamp_(ts);
      // Identificador primario: FormsID (UUID) si existe, si no el timestamp ISO
      const formsId = (formsIdCol >= 0 && row[formsIdCol] && String(row[formsIdCol]).trim())
                      ? String(row[formsIdCol]).trim()
                      : tsStr;

      // 1. Si el FormsID/timestamp ya está en PQRS como FormsKey → ya importado
      if (formsId && processedFormsKeys.has(formsId)) return;
      // 2. Fallback para entradas sin FormsKey: comparar CreadoEn
      if (tsStr && processedTs.has(tsStr)) return;
      // 3. Si la fila está marcada como "Revisado" en la hoja de Forms → ya procesada
      if (revisadoCol >= 0 && String(row[revisadoCol]).trim().toUpperCase() === 'TRUE') return;

      const nombre      = getFormValue_(formsHeaders, row, ['Nombre completo', 'Nombre', 'Nombres', 'Nombre del solicitante', 'Nombre y apellidos'], 1);
      const correo      = getFormValue_(formsHeaders, row, ['Correo electrónico donde recibirás respuesta y seguimiento de tu PQRS.', 'Correo electrónico', 'Correo electronico', 'Correo', 'Email', 'E-mail'], 2);
      const telefono    = getFormValue_(formsHeaders, row, ['Teléfono', 'Telefono', 'Celular', 'Móvil', 'Movil', 'Tel'], 3);
      const estudiante  = getFormValue_(formsHeaders, row, ['Nombre del estudiante', 'Estudiante', 'Nombre estudiante', 'Nombre del hijo', 'Nombre del hijo/a'], 4);
      const tiposol     = getFormValue_(formsHeaders, row, ['Tipo de solicitud', 'Tipo de Solicitud', 'Tipo PQRS', 'Tipo', 'Categoría', 'Categoria'], 5);
      const requiere    = getFormValue_(formsHeaders, row, ['Requiere respuesta', 'Requiere Respuesta'], 6) || 'Si';
      const descripcion = getFormValue_(formsHeaders, row, ['Descripción de la solicitud', 'Descripcion de la solicitud', 'Descripción', 'Descripcion', 'Mensaje', 'Detalle', 'Detalle de la solicitud', 'Su solicitud'], 7);
      const grado       = getFormValue_(formsHeaders, row, ['Grado', 'Grado del estudiante', 'Curso', 'Grado/Curso', 'Grado o curso'], 8);
      const solicitante = getFormValue_(formsHeaders, row, CAMPOS_TIPO_SOLICITANTE, -1) ||
        valorParcial_(formsHeaders.map(function(h, i) { return [h, row[i]]; }), CLAVES_PARCIALES_SOLICITANTE);

      // Registrar para evitar duplicados dentro de esta misma llamada a getData()
      processedFormsKeys.add(formsId);

      const fecha = ts instanceof Date
        ? Utilities.formatDate(ts, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : tsStr.slice(0, 10);
      pqrsRows.push({
        ID: '', Fecha: fecha, Dependencia: '',
        Nombre:        nombre,
        Telefono:      telefono,
        Correo:        correo,
        Estudiante:    estudiante,
        Grado:         grado,
        TipoSolicitante: solicitante,
        TipoSolicitud: tiposol,
        MedioRecepcion:'Forms',
        RequiereRespuesta: requiere,
        Descripcion:   descripcion,
        Estado: 'Borrador', EmailPendiente: 'FALSE',
        CreadoEn: tsStr, OrigenForms: 'TRUE', FormsKey: formsId
      });
    });
  }
  // IDs pendientes: parten del mayor número a la vista o ya reservado, para no repetir ninguno
  let maxNum = ultimoIdReservado_();
  pqrsRows.forEach(r => {
    const n = numeroDeId_(String(r.ID || '').trim());
    if (n > maxNum) maxNum = n;
  });
  pqrsRows.forEach(r => {
    if (!r.ID) {
      maxNum++;
      r.ID = formatoId_(maxNum);
    }
  });
  // Adjuntar seguimientos y bandeja a cada PQRS
  pqrsRows.forEach(r => {
    const n = normalizarSolicitante_(r.TipoSolicitante, r.Estudiante, r.Grado);   // corrige datos del formulario anterior
    r.TipoSolicitante = n.tipo;
    r.Estudiante = n.estudiante;
    r.Grado = n.grado;
    r.Bandeja = bandejaDeTipo_(n.tipo, n.grado);
    r.seguimientos = segMap[r.ID] || [];
  });
  return jsonOut(pqrsRows.filter(r => perfilVeBandeja_(perfil, r.Bandeja)));
}

function normalizeTimestamp_(value) {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value).trim();
}

function buildFormKey_(correo, descripcion) {
  return (String(correo || '').trim() + '|' + String(descripcion || '').trim()).toLowerCase();
}

function normalizeStr_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Busca el valor de una pregunta del Forms por su título. La posición de columna (fallbackIndex) es el
// último recurso y SOLO se usa si ningún título candidato existe en la hoja: si la pregunta existe pero la
// persona no la contestó (p. ej. un colaborador no llena «Nombre del estudiante»), el valor es vacío.
function getFormValue_(headers, row, names, fallbackIndex) {
  let encontrada = false;
  for (const name of names) {
    const idx = headers.indexOf(name);
    if (idx >= 0) {
      encontrada = true;
      if (row[idx] !== undefined && String(row[idx]).trim()) return String(row[idx]).trim();
    }
  }
  // Segundo intento: comparación sin tildes, mayúsculas ni signos de puntuación
  for (const name of names) {
    const norm = normKey_(name);
    const idx = headers.findIndex(h => normKey_(h) === norm);
    if (idx >= 0) {
      encontrada = true;
      if (row[idx] !== undefined && String(row[idx]).trim()) return String(row[idx]).trim();
    }
  }
  if (encontrada) return '';
  return fallbackIndex >= 0 && row[fallbackIndex] !== undefined ? String(row[fallbackIndex]).trim() : '';
}

// Arma la fila de la hoja PQRS a partir de la solicitud del cliente. Los campos que el cliente no
// administra (TokenRespuesta, y Calificacion mientras el cliente no la envíe) conservan lo que ya había.
function construirFila_(s, hdrs, previa) {
  const t = normalizarSolicitante_(s.tipoSolicitante, s.estudiante, s.grado);
  const v = {
    ID: s.id, Fecha: s.fecha || '', Dependencia: s.dependencia || '', Nombre: s.nombre || '',
    Telefono: s.telefono || '', Correo: s.correo || '', Estudiante: t.estudiante, Grado: t.grado,
    TipoSolicitud: s.tipoSolicitud || '', MedioRecepcion: s.medioRecepcion || '',
    RequiereRespuesta: s.requiereRespuesta || '', Descripcion: s.descripcion || '',
    Estado: s.estado || 'Borrador', EmailPendiente: s.emailPendiente ? 'TRUE' : 'FALSE',
    CreadoEn: s.createdAt || '', OrigenForms: s.origenForms ? 'TRUE' : 'FALSE',
    ObservacionSolicitante: s.observacionSolicitante || '', FechaObservacion: s.fechaObservacion || '',
    FormsKey: s.formsKey || '', TipoSolicitante: t.tipo
  };
  return hdrs.map(function(h, i) {
    if (h === 'Calificacion') {
      return (s.calificacion !== undefined && s.calificacion !== null && s.calificacion !== '')
        ? s.calificacion : (previa ? previa[i] : '');
    }
    if (h && Object.prototype.hasOwnProperty.call(v, h)) return v[h];
    return previa && previa[i] !== undefined ? previa[i] : '';
  });
}

// Guarda lo que envía el cliente SIN reescribir la hoja completa:
//  · Cada solicitud se actualiza fila por fila (por ID); solo se escriben las filas que cambiaron.
//  · Las solicitudes que el cliente no mencione NO se borran (puede haber llegado una nueva del Forms
//    mientras tanto, o ser de otra bandeja). Solo se elimina lo que el cliente pide en «eliminados»
//    (únicamente borradores que el perfil puede ver).
//  · El perfil solo puede crear o modificar solicitudes de su bandeja (Rectoría, todas).
//  · Los seguimientos nunca se borran: se actualizan por identidad y se agregan los nuevos.
//  · Todo ocurre bajo candado: dos personas guardando a la vez ya no se pisan.
function syncData(solicitudes, auth, eliminados) {
  const perfil = auth && auth.perfil;
  if (!perfil) return jsonOut({ok: false, error: 'Sesión sin perfil.'});
  if (!Array.isArray(solicitudes)) return jsonOut({ok: false, error: 'Datos inválidos.'});
  return conBloqueoJson_(function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    const segSheet = ss.getSheetByName(SEG_SHEET) || ss.insertSheet(SEG_SHEET);
    const hdrs = ensureHeaders(sheet);
    const segHdrs = ensureSegHeaders_(segSheet);
    const H = mapaEncabezados_(hdrs);
    const S = mapaEncabezados_(segHdrs);

    const nFilas = Math.max(sheet.getLastRow() - 1, 0);
    let actuales = nFilas ? sheet.getRange(2, 1, nFilas, hdrs.length).getValues() : [];
    const idDe = function(row) { return String(row[H.ID] || '').trim(); };
    const bandejaDe = function(row) { return bandejaDeTipo_(row[H.TipoSolicitante], row[H.Grado]); };
    const visible = function(row) { return perfilVeBandeja_(perfil, bandejaDe(row)); };
    const posPorId = {};
    actuales.forEach(function(row, i) { const id = idDe(row); if (id) posPorId[id] = i; });

    // 1) Eliminaciones pedidas: solo borradores visibles para este perfil
    const aEliminar = {};
    (Array.isArray(eliminados) ? eliminados : []).forEach(function(raw) {
      const id = String(raw || '').trim();
      if (!id || posPorId[id] === undefined) return;
      const row = actuales[posPorId[id]];
      if (String(row[H.Estado] || '') === 'Borrador' && visible(row)) aEliminar[id] = true;
    });

    // 2) Solicitudes entrantes que este perfil puede escribir
    const entrantes = {};
    const orden = [];
    let rechazadas = 0;
    solicitudes.forEach(function(s) {
      const id = String((s && s.id) || '').trim();
      if (!id || aEliminar[id]) return;
      const previa = posPorId[id] !== undefined ? actuales[posPorId[id]] : null;
      const t = normalizarSolicitante_(s.tipoSolicitante, s.estudiante, s.grado);
      // Una existente la puede modificar quien hoy la ve (incluso reasignarla a la otra bandeja);
      // una nueva debe pertenecer a la bandeja del perfil.
      const permitido = previa ? visible(previa) : perfilVeBandeja_(perfil, bandejaDeTipo_(t.tipo, t.grado));
      if (!permitido) { rechazadas++; return; }
      if (!entrantes[id]) orden.push(id);
      entrantes[id] = s;
    });

    // 3) Borrar (de abajo hacia arriba para no mover las posiciones pendientes)
    const idsBorrar = Object.keys(aEliminar).sort(function(a, b) { return posPorId[b] - posPorId[a]; });
    idsBorrar.forEach(function(id) { sheet.deleteRow(posPorId[id] + 2); });
    if (idsBorrar.length) {
      actuales = actuales.filter(function(row) { const id = idDe(row); return !(id && aEliminar[id]); });
      Object.keys(posPorId).forEach(function(k) { delete posPorId[k]; });
      actuales.forEach(function(row, i) { const id = idDe(row); if (id) posPorId[id] = i; });
    }

    // 4) Actualizar solo las filas que cambiaron
    let actualizadas = 0;
    actuales.forEach(function(row, i) {
      const id = idDe(row);
      if (!id || !entrantes[id]) return;
      const nueva = construirFila_(entrantes[id], hdrs, row);
      if (!filaIgual_(nueva, row)) {
        sheet.getRange(i + 2, 1, 1, hdrs.length).setValues([nueva]);
        actualizadas++;
      }
    });

    // 5) Agregar las nuevas
    const nuevas = orden.filter(function(id) { return posPorId[id] === undefined; })
      .map(function(id) { return construirFila_(entrantes[id], hdrs, null); });
    if (nuevas.length) sheet.getRange(actuales.length + 2, 1, nuevas.length, hdrs.length).setValues(nuevas);

    // 6) Seguimientos: actualizar por identidad y agregar los nuevos; nunca se borran
    const nSeg = Math.max(segSheet.getLastRow() - 1, 0);
    const segActuales = nSeg ? segSheet.getRange(2, 1, nSeg, segHdrs.length).getValues() : [];
    const segPos = {};
    segActuales.forEach(function(row, i) {
      segPos[identidadSeg_(row[S.PQRS_ID], row[S.SegKey], row[S.RegistradoEn], row[S.Tipo] || 'secretaria', row[S.Respuesta])] = i;
    });
    const segNuevos = [];
    orden.forEach(function(id) {
      (entrantes[id].seguimientos || []).forEach(function(seg) {
        const vals = {
          PQRS_ID: id, Fecha: seg.fecha || '', Respuesta: seg.respuesta || '', Estado: seg.estado || '',
          RegistradoEn: seg.registradoEn || '', Tipo: seg.tipo || 'secretaria', Autor: seg.autor || '', SegKey: seg.segKey || ''
        };
        const fila = segHdrs.map(function(h) { return Object.prototype.hasOwnProperty.call(vals, h) ? vals[h] : ''; });
        const ident = identidadSeg_(id, seg.segKey, seg.registradoEn, seg.tipo || 'secretaria', seg.respuesta);
        if (segPos[ident] === -1) return;       // ya se agregó en este mismo envío
        if (segPos[ident] !== undefined) {
          const previa = segActuales[segPos[ident]];
          const nueva = segHdrs.map(function(h, i) { return Object.prototype.hasOwnProperty.call(vals, h) ? vals[h] : previa[i]; });
          if (!filaIgual_(nueva, previa)) segSheet.getRange(segPos[ident] + 2, 1, 1, segHdrs.length).setValues([nueva]);
        } else {
          segPos[ident] = -1;                 // evita agregar dos veces la misma identidad en este envío
          segNuevos.push(fila);
        }
      });
    });
    if (segNuevos.length) segSheet.getRange(segActuales.length + 2, 1, segNuevos.length, segHdrs.length).setValues(segNuevos);

    return jsonOut({ok: true, count: solicitudes.length, actualizadas: actualizadas, nuevas: nuevas.length,
                    eliminadas: idsBorrar.length, rechazadas: rechazadas, segNuevos: segNuevos.length});
  });
}

// Guarda o borra el token de respuesta del solicitante en la hoja PQRS.
// Llame con token='' para invalidar (después de que el solicitante lo usa).
function _actualizarTokenRespuesta_(id, token) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return;
    var data  = sheet.getDataRange().getValues();
    var hdrs  = data[0];
    var idIdx = hdrs.indexOf('ID');
    var tkIdx = hdrs.indexOf('TokenRespuesta');
    if (tkIdx < 0) {
      // Crear columna si no existe
      tkIdx = hdrs.length;
      sheet.getRange(1, tkIdx + 1).setValue('TokenRespuesta').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
    }
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx] || '').trim() === id) {
        sheet.getRange(i + 1, tkIdx + 1).setValue(token);
        return;
      }
    }
  } catch(e) { Logger.log('_actualizarTokenRespuesta_ error: ' + e.message); }
}

function sendEmailFromParams_(p) {
  const destinatario  = String(p.correo      || '').trim();
  const googleToken   = String(p.googleToken || '').trim();
  if (!destinatario) return jsonOut({ok: false, error: 'La solicitud no tiene correo del solicitante'});
  const sinEnlace = p.sinEnlace === 'true';
  const contexto  = String(p.contexto || 'respuesta');
  const bandeja   = bandejaDeTipo_(p.tipoSolicitante, p.grado);
  const asunto = sinEnlace
    ? '[Colegio Goyavier] Recibimos tu solicitud · ' + p.id
    : contexto === 'respuestaObservacion'
      ? '[Colegio Goyavier] Revisamos tu observación — nueva respuesta · ' + p.id
      : '[Colegio Goyavier] Tenemos novedades sobre tu solicitud · ' + p.id;
  // Cada envío genera un token único — al usarlo queda invalidado
  var tkn = '';
  var enlaceRespuesta = '';
  var bloqueEnlace = '';
  if (!sinEnlace) {
    tkn = Utilities.getUuid();
    conBloqueo_(function() { _actualizarTokenRespuesta_(p.id, tkn); });
    enlaceRespuesta = ScriptApp.getService().getUrl() +
      '?action=responder&id=' + encodeURIComponent(p.id) +
      '&tkn=' + encodeURIComponent(tkn);
    bloqueEnlace =
      '──────────────────────────────────────────\n' +
      'Cuéntanos cómo te fue. Haz clic en el siguiente enlace para\n' +
      'confirmar si tu caso fue resuelto o para registrar una observación:\n' +
      enlaceRespuesta + '\n' +
      '(Este enlace es de un solo uso. Si necesitas usarlo de nuevo,\n' +
      ' te enviaremos uno nuevo con nuestra próxima comunicación.)\n' +
      '──────────────────────────────────────────\n\n';
  }
  const nombre = p.nombre || 'estimado(a) solicitante';
  const dep    = p.dependencia || 'el equipo responsable';

  var intro, detalle, cierre;

  if (contexto === 'despacho') {
    intro =
      'Hola, ' + nombre + '. Esperamos que te encuentres muy bien.\n\n' +
      'Queremos informarte que tu solicitud PQRS ya fue recibida y registrada correctamente en nuestro sistema.\n' +
      'La hemos asignado al equipo de ' + dep + ', que será el encargado de revisarla y darte una respuesta oportuna.\n\n';
    detalle =
      'Número de solicitud : ' + p.id + '\n' +
      'Fecha de asignación : ' + p.segFecha + '\n' +
      'Estado              : En gestión\n' +
      lineasEstudiante_(p.estudiante, p.grado) + '\n';
    cierre =
      'Tan pronto tengamos una respuesta para ti, te la haremos llegar a este mismo correo.\n' +
      'Gracias por confiar en el Colegio Goyavier Campestre. Tu tranquilidad es lo más importante para nosotros.\n\n';
  } else if (contexto === 'respuestaObservacion') {
    intro =
      'Hola, ' + nombre + '. Esperamos que te encuentres muy bien.\n\n' +
      'Nos comunicamos contigo porque recibimos y revisamos con mucho cuidado la observación que registraste sobre tu solicitud PQRS.\n' +
      'Nuestro equipo de ' + dep + ' realizó un nuevo seguimiento a tu caso y ya contamos con una nueva respuesta relacionada con lo que nos comentaste.\n\n' +
      'Hemos revisado nuevamente tu caso para brindarte una mejor atención. Tu opinión es muy importante para nosotros.\n\n';
    detalle =
      'Número de solicitud : ' + p.id + '\n' +
      'Fecha de gestión    : ' + p.segFecha + '\n' +
      'Estado              : ' + p.segEstado + '\n' +
      lineasEstudiante_(p.estudiante, p.grado) + '\n' +
      'Nueva respuesta de nuestro equipo:\n' + p.segRespuesta + '\n\n';
    cierre =
      'Seguimos trabajando para ofrecerte la mejor experiencia y acompañamiento.\n' +
      'Gracias por permitirnos continuar mejorando nuestro servicio. Tu voz hace la diferencia.\n\n';
  } else {
    // contexto === 'respuesta' (primera respuesta oficial)
    intro =
      'Hola, ' + nombre + '. Esperamos que te encuentres muy bien.\n\n' +
      '¡Tenemos novedades sobre tu solicitud! El equipo de ' + dep + ' ya la revisó y gestionó.\n' +
      'A continuación te compartimos la respuesta oficial para tu caso.\n\n';
    detalle =
      'Número de solicitud : ' + p.id + '\n' +
      'Fecha de gestión    : ' + p.segFecha + '\n' +
      'Estado              : ' + p.segEstado + '\n' +
      lineasEstudiante_(p.estudiante, p.grado) + '\n' +
      'Respuesta de nuestro equipo:\n' + p.segRespuesta + '\n\n';
    cierre =
      'Si tienes alguna pregunta adicional o consideras que tu caso no fue resuelto satisfactoriamente,\n' +
      'puedes registrar una observación usando el enlace que encontrarás más abajo.\n' +
      'Estamos aquí para acompañarte en todo el proceso.\n\n';
  }

  const cuerpo =
    intro +
    detalle +
    cierre +
    bloqueEnlace +
    'En el Colegio Goyavier Campestre trabajamos cada día para brindarte la mejor atención.\n' +
    (bandeja === BANDEJA_TALENTO ? 'Tu opinión es muy importante para nosotros.\n\n' : 'Tu bienestar y el de tu familia son muy importantes para nosotros.\n\n') +
    'Con mucho gusto te atendemos,\nEquipo PQRS · Colegio Goyavier Campestre';
  const opts = {name: 'PQRS Colegio Goyavier', replyTo: correoDeBandeja_(bandeja)};
  // Intentar enviar desde la cuenta del usuario autenticado via Gmail API
  if (googleToken) {
    try {
      sendViaGmailApi_(googleToken, destinatario, asunto, cuerpo, opts);
      return jsonOut({ok: true, to: destinatario, via: 'gmail_api'});
    } catch(gmailErr) {
      if (gmailErr.message === 'TOKEN_EXPIRED') {
        return jsonOut({ok: false, error: 'TOKEN_EXPIRED', msg: 'La sesión de Google expiró. Por favor inicia sesión nuevamente.'});
      }
      Logger.log('Gmail API error, usando GmailApp como fallback: ' + gmailErr.message);
    }
  }
  // Fallback: GmailApp (envía desde la cuenta dueña del script)
  GmailApp.sendEmail(destinatario, asunto, cuerpo, opts);
  return jsonOut({ok: true, to: destinatario, via: 'gmailapp'});
}

function sendResponseEmail(solicitud, seguimiento) {
  if (!solicitud || !seguimiento) return jsonOut({ok: false, error: 'Solicitud o seguimiento no recibido'});
  return sendEmailFromParams_({
    correo: solicitud.correo, id: solicitud.id, nombre: solicitud.nombre,
    estudiante: solicitud.estudiante, grado: solicitud.grado, tipoSolicitante: solicitud.tipoSolicitante,
    segFecha: seguimiento.fecha, segRespuesta: seguimiento.respuesta, segEstado: seguimiento.estado
  });
}

function markFormsRow(identifier) {
  if(!identifier) return jsonOut({error: 'No identifier provided'});
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FORMS_SHEET);
  if(!sheet || sheet.getLastRow() < 2) return jsonOut({ok: false, msg: 'Hoja Forms no encontrada'});
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  // Columna FormsID (UUID estable) y columna Revisado
  const formsIdCol = headers.indexOf('FormsID');
  let revisadoCol = headers.indexOf('Revisado');
  if(revisadoCol < 0) {
    revisadoCol = headers.length;
    sheet.getRange(1, revisadoCol + 1).setValue('Revisado').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
  }
  for(let i = 1; i < data.length; i++) {
    // Primero intentar coincidencia por FormsID (UUID, más confiable)
    if(formsIdCol >= 0 && String(data[i][formsIdCol] || '').trim() === identifier) {
      sheet.getRange(i + 1, revisadoCol + 1).setValue('TRUE');
      return jsonOut({ok: true, row: i + 1, matchedBy: 'formsId'});
    }
    // Fallback: coincidencia por timestamp (para filas anteriores sin FormsID)
    const ts = data[i][0];
    const tsStr = ts instanceof Date ? ts.toISOString() : String(ts).trim();
    if(tsStr === identifier) {
      sheet.getRange(i + 1, revisadoCol + 1).setValue('TRUE');
      return jsonOut({ok: true, row: i + 1, matchedBy: 'timestamp'});
    }
  }
  return jsonOut({ok: false, msg: 'Fila no encontrada para identificador: ' + identifier});
}

function serveFormRespuestaArea_(p) {
  const id       = String(p.id   || '').trim();
  const area     = String(p.area || 'Área').trim();
  const tipoResp = String(p.tipo || '').trim(); // 'observacion' cuando el área responde a una obs del solicitante
  if (!id) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Enlace invalido.</p>');
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Sistema no disponible.</p>');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx     = headers.indexOf('ID');
    const nombreIdx = headers.indexOf('Nombre');
    const tipoIdx   = headers.indexOf('TipoSolicitud');
    const descIdx   = headers.indexOf('Descripcion');
    const estadoIdx = headers.indexOf('Estado');
    const obsIdx    = headers.indexOf('ObservacionSolicitante');
    const row = data.slice(1).find(function(r) { return String(r[idIdx]).trim() === id; });
    if (!row) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Solicitud no encontrada.</p>');
    const nombre    = String(row[nombreIdx] || '');
    const tipo      = String(row[tipoIdx]   || '');
    const desc      = String(row[descIdx]   || '');
    const estado    = String(row[estadoIdx] || '');
    const obsSolic  = (tipoResp === 'observacion' && obsIdx >= 0) ? String(row[obsIdx] || '').trim() : '';
    const formNonce = Utilities.getUuid();
    const scriptUrl = ScriptApp.getService().getUrl();
    const css =
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      'body { font-family: Segoe UI, sans-serif; background: linear-gradient(145deg,#073f6e 0%,#0d5a96 55%,#1575bc 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }' +
      '.card { background: #fff; border-radius: 14px; overflow: hidden; width: 100%; max-width: 540px; box-shadow: 0 16px 48px rgba(7,63,110,0.35); }' +
      '.card-header { background: linear-gradient(90deg,#073f6e,#1575bc); color: #fff; padding: 20px 24px; }' +
      '.card-header h1 { font-size: 16px; font-weight: 700; margin-bottom: 2px; }' +
      '.card-header p { font-size: 12px; opacity: 0.8; }' +
      '.card-body { padding: 24px; }' +
      '.info { background: #e8f4fd; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px; line-height: 1.8; }' +
      '.info b { color: #0d5a96; }' +
      '.desc { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; font-size: 13px; line-height: 1.6; color: #2d3748; margin-bottom: 16px; }' +
      'label { display: block; font-size: 12px; font-weight: 700; color: #718096; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }' +
      'textarea { width: 100%; min-height: 130px; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; font-family: inherit; resize: vertical; outline: none; }' +
      'textarea:focus { border-color: #1575bc; }' +
      'button { width: 100%; margin-top: 14px; background: linear-gradient(90deg,#0d5a96,#1575bc); color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 15px; font-weight: 700; cursor: pointer; }' +
      '.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; background: #e8f4fd; color: #0d5a96; }';
    const html =
      '<!DOCTYPE html><html lang="es"><head>' +
      '<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
      '<title>Colegio Goyavier · Registra tu respuesta</title>' +
      '<style>' + css + '</style></head><body>' +
      '<div class="card">' +
      '<div class="card-header"><h1>Colegio Goyavier Campestre &mdash; ' + sanitizeHtml_(area) + '</h1><p>Sistema PQRS &middot; Tu respuesta hace la diferencia para nuestras familias</p></div>' +
      '<div class="card-body">' +
      '<div class="info">' +
      '<b>Solicitud:</b> ' + sanitizeHtml_(id) + ' &nbsp; <span class="badge">' + sanitizeHtml_(tipo) + '</span><br>' +
      '<b>Solicitante:</b> ' + sanitizeHtml_(nombre) + '<br>' +
      '<b>Estado actual:</b> ' + sanitizeHtml_(estado) +
      '</div>' +
      '<div class="desc"><b>Descripción de la solicitud:</b><br>' + sanitizeHtml_(desc) + '</div>' +
      (obsSolic ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.6;color:#2d3748;"><b style="color:#92400e;display:block;margin-bottom:6px;">&#x26A0;&#xFE0F; El solicitante registró una nueva observación:</b>' + sanitizeHtml_(obsSolic) + '</div>' : '') +
      '<label for="obs">' + (obsSolic ? 'Tu respuesta a la observación del solicitante' : 'Tu respuesta o gestión del caso') + '</label>' +
      '<textarea id="obs" required placeholder="Describe detalladamente la gestión realizada o la respuesta a esta solicitud..."></textarea>' +
      '<button id="sbtn" onclick="enviarRespuestaArea()">Registrar mi respuesta</button>' +
      '<div id="msg-error" style="display:none;color:#c53030;margin-top:10px;font-size:13px;"></div>' +
      '<script>' +
      'var SCRIPT_URL = "' + scriptUrl + '";' +
      'var SOL_ID = "' + id + '";' +
      'var SOL_AREA = "' + area.replace(/"/g, '\\"') + '";' +
      'var FORM_NONCE = "' + formNonce + '";' +
      'function enviarRespuestaArea() {' +
      '  var obs = document.getElementById("obs").value.trim();' +
      '  if (!obs) { document.getElementById("msg-error").style.display="block"; document.getElementById("msg-error").textContent="Por favor escribe tu respuesta o gestión antes de continuar."; return; }' +
      '  var btn = document.getElementById("sbtn");' +
      '  btn.disabled = true; btn.textContent = "Enviando...";' +
      '  document.getElementById("msg-error").style.display="none";' +
      '  var url = SCRIPT_URL + "?action=guardarRespuestaAreaJson&id=" + encodeURIComponent(SOL_ID) + "&area=" + encodeURIComponent(SOL_AREA) + "&obs=" + encodeURIComponent(obs) + "&nonce=" + encodeURIComponent(FORM_NONCE);' +
      '  fetch(url)' +
      '    .then(function(r){ return r.json(); })' +
      '    .then(function(data){' +
      '      if (data.ok) {' +
      '        document.querySelector(".card-body").innerHTML = \'<div style="text-align:center;padding:30px 0;"><div style="font-size:48px;margin-bottom:16px;">&#x2705;</div><h2 style="color:#0d5a96;margin-bottom:10px;">¡Respuesta registrada!</h2><p style="color:#718096;font-size:14px;line-height:1.7;">¡Gracias por tu gestión! La respuesta a la solicitud <strong>' + id + '</strong> fue registrada exitosamente.<br><br>El equipo de PQRS del colegio la revisará y la enviará al solicitante a la brevedad. Tu aporte es fundamental para brindar la mejor atención a nuestras familias.</p></div>\';' +
      '      } else {' +
      '        btn.disabled = false; btn.textContent = "Registrar mi respuesta";' +
      '        document.getElementById("msg-error").style.display="block";' +
      '        document.getElementById("msg-error").textContent = "Error: " + (data.error || "Por favor intenta de nuevo.");' +
      '      }' +
      '    })' +
      '    .catch(function(err){' +
      '      btn.disabled = false; btn.textContent = "Registrar mi respuesta";' +
      '      document.getElementById("msg-error").style.display="block";' +
      '      document.getElementById("msg-error").textContent = "Error de conexión. Por favor intenta de nuevo.";' +
      '    });' +
      '}' +
      '</script>' +
      '</div></div></body></html>';
    return HtmlService.createHtmlOutput(html).setTitle('Colegio Goyavier · Registra tu respuesta');
  } catch(err) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Error: ' + err.message + '</p>');
  }
}

function guardarRespuestaArea_(p) {
  const id   = String(p.id   || '').trim();
  const area = String(p.area || '').trim();
  const obs  = String(p.obs  || '').trim();
  if (!id || !obs) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Datos incompletos. Por favor regrese e intente de nuevo.</p>');
  try {
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const segSheet = ss.getSheetByName(SEG_SHEET) || ss.insertSheet(SEG_SHEET);
    // Asegurar cabecera con columnas Tipo y Autor
    if (segSheet.getLastRow() === 0) {
      const hdrs = ['PQRS_ID','Fecha','Respuesta','Estado','RegistradoEn','Tipo','Autor','SegKey'];
      segSheet.appendRow(hdrs);
      segSheet.getRange(1,1,1,hdrs.length).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
    } else {
      const existH = segSheet.getRange(1, 1, 1, segSheet.getLastColumn()).getValues()[0];
      if (existH.indexOf('Tipo') < 0) {
        const tc = existH.length + 1;
        segSheet.getRange(1, tc  ).setValue('Tipo' ).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
        segSheet.getRange(1, tc+1).setValue('Autor').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      }
      if (existH.indexOf('SegKey') < 0) {
        const skc = segSheet.getLastColumn() + 1;
        segSheet.getRange(1, skc).setValue('SegKey').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      }
    }
    const fechaHoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const ahora    = new Date().toISOString();
    segSheet.appendRow([id, fechaHoy, obs, 'Proceso', ahora, 'area', area, '']);
    const html =
      '<!DOCTYPE html><html lang="es"><head>' +
      '<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
      '<title>¡Respuesta registrada! · Colegio Goyavier</title>' +
      '<style>* { box-sizing: border-box; margin: 0; padding: 0; }' +
      'body { font-family: Segoe UI, sans-serif; background: linear-gradient(145deg,#073f6e 0%,#0d5a96 55%,#1575bc 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }' +
      '.card { background: #fff; border-radius: 14px; width: 100%; max-width: 420px; box-shadow: 0 16px 48px rgba(7,63,110,0.35); text-align: center; padding: 40px 28px; }' +
      '.icon { font-size: 48px; margin-bottom: 16px; }' +
      'h2 { color: #0d5a96; font-size: 20px; margin-bottom: 10px; }' +
      'p { color: #718096; font-size: 14px; line-height: 1.7; }</style></head><body>' +
      '<div class="card"><div class="icon">&#x2705;</div>' +
      '<h2>¡Respuesta registrada!</h2>' +
      '<p>¡Gracias por tu gestión! La respuesta del área <strong>' + area + '</strong> fue registrada para la solicitud <strong>' + id + '</strong>.<br><br>' +
      'El equipo de PQRS del colegio la revisará y la enviará al solicitante a la brevedad. Tu aporte es fundamental para brindar la mejor atención a nuestras familias.</p>' +
      '</div></body></html>';
    return HtmlService.createHtmlOutput(html).setTitle('¡Respuesta registrada! · Colegio Goyavier');
  } catch(err) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;color:#e53e3e;">Error: ' + err.message + '</p>');
  }
}

function serveFormRespuesta_(p) {
  const id  = String(p.id  || '').trim();
  const tkn = String(p.tkn || '').trim();
  if (!id) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Enlace invalido. Por favor contacte al colegio.</p>');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Sistema no disponible.</p>');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx         = headers.indexOf('ID');
    const nombreIdx     = headers.indexOf('Nombre');
    const estudianteIdx = headers.indexOf('Estudiante');
    const tipoIdx       = headers.indexOf('TipoSolicitud');
    const estadoIdx     = headers.indexOf('Estado');
    const tokenIdx      = headers.indexOf('TokenRespuesta');
    const row = data.slice(1).find(function(r) { return String(r[idIdx]).trim() === id; });
    if (!row) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Solicitud no encontrada. Verifique el enlace.</p>');
    const correoContacto = correoDeBandeja_(bandejaDeFilaArray_(headers, row));
    const estado       = String(row[estadoIdx] || '');
    const nombre       = String(row[nombreIdx] || '');
    const estudiante   = String(row[estudianteIdx] || '');
    const tipo         = String(row[tipoIdx] || '');
    const tokenGuardado= tokenIdx >= 0 ? String(row[tokenIdx] || '').trim() : '';
    const yaCerrado    = estado === 'Cerrado';
    // Token inválido o ya usado → bloquear (excepto si el PQRS está cerrado, mostramos mensaje de cierre)
    const tokenValido  = tkn && tokenGuardado && tkn === tokenGuardado;
    const scriptUrl    = ScriptApp.getService().getUrl();

    const css =
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      'body { font-family: Segoe UI, sans-serif; background: linear-gradient(145deg,#073f6e 0%,#0d5a96 55%,#1575bc 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }' +
      '.card { background: #fff; border-radius: 14px; overflow: hidden; width: 100%; max-width: 500px; box-shadow: 0 16px 48px rgba(7,63,110,0.35); }' +
      '.card-header { background: linear-gradient(90deg,#073f6e,#1575bc); color: #fff; padding: 20px 24px; }' +
      '.card-header h1 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }' +
      '.card-header p { font-size: 12px; opacity: 0.8; }' +
      '.card-body { padding: 24px; }' +
      '.info { background: #e8f4fd; border-radius: 8px; padding: 10px 14px; margin-bottom: 18px; font-size: 13px; line-height: 1.7; }' +
      '.info b { color: #0d5a96; }' +
      'select { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; font-family: inherit; outline: none; background: #fff; cursor: pointer; margin-bottom: 18px; }' +
      'select:focus { border-color: #1575bc; }' +
      'label { display: block; font-size: 12px; font-weight: 700; color: #718096; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }' +
      'textarea { width: 100%; min-height: 110px; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; font-family: inherit; resize: vertical; outline: none; }' +
      'textarea:focus { border-color: #1575bc; }' +
      '.btn { width: 100%; margin-top: 14px; border: none; border-radius: 8px; padding: 12px; font-size: 15px; font-weight: 700; cursor: pointer; }' +
      '.btn-primary { background: linear-gradient(90deg,#0d5a96,#1575bc); color: #fff; }' +
      '.btn-danger { background: linear-gradient(90deg,#c53030,#e53e3e); color: #fff; }' +
      '.section { display: none; }' +
      '.confirm-box { background: #fff5f5; border: 1.5px solid #fed7d7; border-radius: 8px; padding: 14px; font-size: 13px; color: #742a2a; line-height: 1.6; margin-bottom: 14px; }' +
      '.msg { text-align: center; padding: 14px; font-size: 14px; border-radius: 8px; margin-top: 4px; }' +
      '.warn { color: #856404; background: #fffbeb; }' +
      '.success { color: #276749; background: #f0fff4; }' +
      '.err-msg { display:none; color:#c53030; margin-top:10px; font-size:13px; }' +
      '.rating-box { margin: 0 0 14px; padding: 14px; background: #fffbeb; border: 1.5px solid #f6e05e; border-radius: 8px; }' +
      '.rating-label { font-size: 13px; font-weight: 700; color: #744210; margin-bottom: 10px; }' +
      '.stars { display: flex; gap: 8px; font-size: 34px; cursor: pointer; margin-bottom: 6px; }' +
      '.star { color: #d0d0d0; transition: color 0.15s; user-select: none; line-height: 1; }' +
      '.star.active { color: #f6a609; }' +
      '.rating-text { font-size: 12px; color: #856404; min-height: 16px; font-weight: 600; }';

    var formBody;
    if (yaCerrado) {
      formBody =
        '<div class="msg success">&#x2705; ¡Tu solicitud fue cerrada exitosamente!<br><br>' +
        'Nos alegra mucho saber que tu caso fue atendido de manera satisfactoria.<br><br>' +
        'En el Colegio Goyavier Campestre trabajamos cada día para brindarte la mejor atención. ¡Gracias por confiar en nosotros!</div>';
    } else if (!tokenValido) {
      formBody =
        '<div class="msg warn">&#x1F512; Este enlace ya fue utilizado o ya no está disponible.<br><br>' +
        'Nos pondremos en contacto contigo cuando tengamos novedades sobre tu solicitud. Te enviaremos un nuevo enlace para continuar.<br><br>' +
        'Gracias por permitirnos acompañarte en este proceso. Si tienes alguna duda, escríbenos a <a href="mailto:' + correoContacto + '">' + correoContacto + '</a>.</div>';
    } else {
      formBody =
        '<label for="accion">¿Cómo podemos ayudarte hoy?</label>' +
        '<select id="accion" onchange="mostrarSeccion(this.value)">' +
        '  <option value="">-- Cuéntanos qué necesitas --</option>' +
        '  <option value="cerrar">Estoy satisfecho(a), deseo cerrar mi solicitud</option>' +
        '  <option value="obs">Tengo una observación o quiero añadir algo más</option>' +
        '</select>' +

        // Sección: cerrar
        '<div id="sec-cerrar" class="section">' +
        '  <div class="confirm-box">Al confirmar, tu solicitud quedará cerrada y registraremos que tu caso fue atendido satisfactoriamente. ¡Gracias por tu confianza!</div>' +
        '  <div class="rating-box">' +
        '    <p class="rating-label">&#x2B50; ¿Cómo calificarías la atención recibida? <span style="color:#c53030;font-size:12px;">(requerido)</span></p>' +
        '    <div class="stars" id="estrellas">' +
        '      <span class="star" onclick="setRating(1)">&#x2605;</span>' +
        '      <span class="star" onclick="setRating(2)">&#x2605;</span>' +
        '      <span class="star" onclick="setRating(3)">&#x2605;</span>' +
        '      <span class="star" onclick="setRating(4)">&#x2605;</span>' +
        '      <span class="star" onclick="setRating(5)">&#x2605;</span>' +
        '    </div>' +
        '    <p class="rating-text" id="rating-text">Toca una estrella para calificar</p>' +
        '  </div>' +
        '  <button class="btn btn-danger" id="btn-cerrar" onclick="cerrarPqrs()">&#x2714;&#xFE0F; Confirmar, estoy satisfecho(a)</button>' +
        '  <div id="err-cerrar" class="err-msg"></div>' +
        '</div>' +

        // Sección: observación
        '<div id="sec-obs" class="section">' +
        '  <label for="obs">Cuéntanos tu observación o inconformidad</label>' +
        '  <textarea id="obs" placeholder="Cuéntanos con detalle tu observación o inconformidad..."></textarea>' +
        '  <button class="btn btn-primary" id="btn-obs" onclick="enviarObservacion()">&#x1F4E8; Enviar mi observación</button>' +
        '  <div id="err-obs" class="err-msg"></div>' +
        '</div>' +

        '<script>' +
        'var SCRIPT_URL = "' + scriptUrl + '";' +
        'var SOL_ID  = "' + id  + '";' +
        'var SOL_TKN = "' + tkn + '";' +
        'var selectedRating = 0;' +
        'var ratingLabels = ["","Muy malo 😞","Malo 🙁","Regular 😐","Bueno 😊","\\u00A1Excelente! 😄"];' +

        'function mostrarSeccion(val) {' +
        '  document.getElementById("sec-cerrar").style.display = val === "cerrar" ? "block" : "none";' +
        '  document.getElementById("sec-obs").style.display    = val === "obs"    ? "block" : "none";' +
        '}' +

        'function setRating(val) {' +
        '  selectedRating = val;' +
        '  var stars = document.querySelectorAll("#estrellas .star");' +
        '  stars.forEach(function(s, i) { s.classList.toggle("active", i < val); });' +
        '  document.getElementById("rating-text").textContent = ratingLabels[val] + " (" + val + "/5)";' +
        '  document.getElementById("err-cerrar").style.display = "none";' +
        '}' +

        'function cerrarPqrs() {' +
        '  var errEl = document.getElementById("err-cerrar");' +
        '  if (!selectedRating) {' +
        '    errEl.style.display = "block"; errEl.textContent = "Por favor selecciona una calificación antes de confirmar el cierre.";' +
        '    return;' +
        '  }' +
        '  var btn = document.getElementById("btn-cerrar");' +
        '  btn.disabled = true; btn.textContent = "Procesando...";' +
        '  errEl.style.display = "none";' +
        '  var url = SCRIPT_URL + "?action=cerrarPqrsJson&id=" + encodeURIComponent(SOL_ID) + "&tkn=" + encodeURIComponent(SOL_TKN) + "&calificacion=" + selectedRating;' +
        '  fetch(url)' +
        '    .then(function(r){ return r.json(); })' +
        '    .then(function(d){' +
        '      if (d.ok) {' +
        '        var starsHtml = "";' +
        '        for (var i = 1; i <= 5; i++) starsHtml += (i <= selectedRating ? "\\u2605" : "\\u2606");' +
        '        document.querySelector(".card-body").innerHTML = \'<div style="text-align:center;padding:30px 0;"><div style="font-size:48px;margin-bottom:16px;">&#x2705;</div><h2 style="color:#0d5a96;margin-bottom:10px;">\\u00A1Muchas gracias!</h2><p style="color:#718096;font-size:14px;line-height:1.7;">Nos alegra saber que tu solicitud <strong>' + id + '</strong> fue atendida de manera satisfactoria.<br><br><span style="font-size:20px;color:#f6a609;">\' + starsHtml + \'</span><br><span style="font-size:13px;color:#856404;font-weight:600;">\' + ratingLabels[selectedRating] + \' (\' + selectedRating + \'/5)</span><br><br>Tu calificaci\\u00F3n ha sido registrada. En el Colegio Goyavier Campestre trabajamos cada d\\u00EDa para brindarte la mejor atenci\\u00F3n.<br><br><a href="mailto:' + correoContacto + '">' + correoContacto + '</a></p></div>\';' +
        '      } else {' +
        '        btn.disabled = false; btn.textContent = "\\u2714\\uFE0F Confirmar, estoy satisfecho(a)";' +
        '        errEl.style.display = "block"; errEl.textContent = "Error: " + (d.error || "Intente de nuevo.");' +
        '      }' +
        '    })' +
        '    .catch(function(){ btn.disabled = false; btn.textContent = "\\u2714\\uFE0F Confirmar, estoy satisfecho(a)"; errEl.style.display = "block"; errEl.textContent = "Error de conexión. Intente de nuevo."; });' +
        '}' +

        'function enviarObservacion() {' +
        '  var obs = document.getElementById("obs").value.trim();' +
        '  var errEl = document.getElementById("err-obs");' +
        '  if (!obs) { errEl.style.display = "block"; errEl.textContent = "Por favor cuéntanos tu observación antes de enviar."; return; }' +
        '  var btn = document.getElementById("btn-obs");' +
        '  btn.disabled = true; btn.textContent = "Enviando...";' +
        '  errEl.style.display = "none";' +
        '  var url = SCRIPT_URL + "?action=guardarRespuestaJson&id=" + encodeURIComponent(SOL_ID) + "&obs=" + encodeURIComponent(obs) + "&tkn=" + encodeURIComponent(SOL_TKN);' +
        '  fetch(url)' +
        '    .then(function(r){ return r.json(); })' +
        '    .then(function(d){' +
        '      if (d.ok) {' +
        '        document.querySelector(".card-body").innerHTML = \'<div style="text-align:center;padding:30px 0;"><div style="font-size:48px;margin-bottom:16px;">&#x1F4E8;</div><h2 style="color:#0d5a96;margin-bottom:10px;">¡Recibimos tu observación!</h2><p style="color:#718096;font-size:14px;line-height:1.7;">Gracias por tomarte el tiempo de compartir tu opinión sobre la solicitud <strong>' + id + '</strong>.<br><br>Nuestro equipo la revisará con atención y te contactaremos a la brevedad. Estamos atentos a brindarte el mejor acompañamiento posible.<br><br>Gracias por permitirnos acompañarte en este proceso.<br><br><a href="mailto:' + correoContacto + '">' + correoContacto + '</a></p></div>\';' +
        '      } else {' +
        '        btn.disabled = false; btn.textContent = "\\u1F4E8 Enviar observacion";' +
        '        errEl.style.display = "block"; errEl.textContent = "Error: " + (d.error || "Intente de nuevo.");' +
        '      }' +
        '    })' +
        '    .catch(function(){ btn.disabled = false; btn.textContent = "Enviar observacion"; errEl.style.display = "block"; errEl.textContent = "Error de conexion. Intente de nuevo."; });' +
        '}' +
        '<\/script>';
    }

    const html =
      '<!DOCTYPE html><html lang="es"><head>' +
      '<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
      '<title>Colegio Goyavier · Respuesta a tu PQRS — Tu opinión es importante para nosotros</title>' +
      '<style>' + css + '</style></head><body>' +
      '<div class="card">' +
      '<div class="card-header"><h1>Colegio Goyavier Campestre</h1><p>Respuesta a tu solicitud PQRS &middot; Tu experiencia y bienestar son lo más importante para nosotros</p></div>' +
      '<div class="card-body">' +
      '<div class="info"><b>Solicitud:</b> ' + id + '<br><b>Solicitante:</b> ' + nombre + '<br><b>Estudiante:</b> ' + estudiante + '<br><b>Tipo:</b> ' + tipo + '</div>' +
      formBody +
      '</div></div></body></html>';
    return HtmlService.createHtmlOutput(html).setTitle('Colegio Goyavier · Respuesta a tu PQRS — Tu opinión es importante para nosotros');
  } catch(err) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Error al cargar el formulario: ' + err.message + '</p>');
  }
}

function guardarRespuestaSolicitante_(p) {
  const id  = String(p.id  || '').trim();
  const obs = String(p.obs || '').trim();
  if (!id || !obs) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;">Datos incompletos. Por favor regrese e intente de nuevo.</p>');
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Hoja PQRS no encontrada');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx     = headers.indexOf('ID');
    const estadoIdx = headers.indexOf('Estado');
    let obsIdx  = headers.indexOf('ObservacionSolicitante');
    let fechaIdx= headers.indexOf('FechaObservacion');
    if (obsIdx < 0) {
      obsIdx = headers.length;
      sheet.getRange(1, obsIdx + 1).setValue('ObservacionSolicitante').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      headers.push('ObservacionSolicitante');
    }
    if (fechaIdx < 0) {
      fechaIdx = headers.length;
      sheet.getRange(1, fechaIdx + 1).setValue('FechaObservacion').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      headers.push('FechaObservacion');
    }
    var rowNum = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]).trim() === id) { rowNum = i + 1; break; }
    }
    if (rowNum < 0) throw new Error('Solicitud ' + id + ' no encontrada');
    const fechaHoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    sheet.getRange(rowNum, estadoIdx + 1).setValue('Apelado');
    sheet.getRange(rowNum, obsIdx   + 1).setValue(obs);
    sheet.getRange(rowNum, fechaIdx + 1).setValue(fechaHoy);
    const html =
      '<!DOCTYPE html><html lang="es"><head>' +
      '<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
      '<title>¡Recibimos tu observación! · Colegio Goyavier</title>' +
      '<style>* { box-sizing: border-box; margin: 0; padding: 0; }' +
      'body { font-family: Segoe UI, sans-serif; background: linear-gradient(145deg,#073f6e 0%,#0d5a96 55%,#1575bc 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }' +
      '.card { background: #fff; border-radius: 14px; width: 100%; max-width: 420px; box-shadow: 0 16px 48px rgba(7,63,110,0.35); text-align: center; padding: 40px 28px; }' +
      '.icon { font-size: 48px; margin-bottom: 16px; }' +
      'h2 { color: #0d5a96; font-size: 20px; margin-bottom: 10px; }' +
      'p { color: #718096; font-size: 14px; line-height: 1.7; }' +
      'a { color: #1575bc; }</style></head><body>' +
      '<div class="card"><div class="icon">&#x1F4E8;</div>' +
      '<h2>¡Recibimos tu observación!</h2>' +
      '<p>Gracias por tomarte el tiempo de compartir tu opinión sobre la solicitud <strong>' + id + '</strong>.<br><br>' +
      'Nuestro equipo la revisará con atención y te contactaremos a la brevedad. Estamos atentos a brindarte el mejor acompañamiento posible.<br><br>' +
      'Gracias por permitirnos acompañarte en este proceso.<br><br>' +
      '<a href="mailto:' + EMAIL_RESP + '">' + EMAIL_RESP + '</a></p>' +
      '</div></body></html>';
    return HtmlService.createHtmlOutput(html).setTitle('¡Recibimos tu observación! · Colegio Goyavier');
  } catch(err) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;color:#e53e3e;">Error al registrar: ' + err.message + '</p>');
  }
}

// Versión JSON de guardarRespuestaSolicitante_ (para fetch desde el formulario público)
function guardarRespuestaSolicitanteJson_(p) {
  const id  = String(p.id  || '').trim();
  const obs = String(p.obs || '').trim().slice(0, 5000);
  const tkn = String(p.tkn || '').trim();
  if (!id || !obs) return jsonOut({ok: false, error: 'Datos incompletos.'});
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return jsonOut({ok: false, error: 'Hoja PQRS no encontrada'});
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx     = headers.indexOf('ID');
    const estadoIdx = headers.indexOf('Estado');
    let obsIdx  = headers.indexOf('ObservacionSolicitante');
    let fechaIdx= headers.indexOf('FechaObservacion');
    if (obsIdx < 0) {
      obsIdx = headers.length;
      sheet.getRange(1, obsIdx + 1).setValue('ObservacionSolicitante').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      headers.push('ObservacionSolicitante');
    }
    if (fechaIdx < 0) {
      fechaIdx = headers.length;
      sheet.getRange(1, fechaIdx + 1).setValue('FechaObservacion').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      headers.push('FechaObservacion');
    }
    var rowNum = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]).trim() === id) { rowNum = i + 1; break; }
    }
    if (rowNum < 0) return jsonOut({ok: false, error: 'Solicitud ' + id + ' no encontrada'});
    // Validar token — debe coincidir con el almacenado para esta solicitud
    const tokenIdx = headers.indexOf('TokenRespuesta');
    const tokenGuardado = tokenIdx >= 0 ? String(data[rowNum - 1][tokenIdx] || '').trim() : '';
    if (!tkn || !tokenGuardado || tkn !== tokenGuardado) {
      return jsonOut({ok: false, error: 'Este enlace ya fue utilizado. Te enviaremos uno nuevo cuando tengamos novedades de tu caso.'});
    }
    // Invalidar el token inmediatamente (uso único)
    _actualizarTokenRespuesta_(id, '');
    const fechaHoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    sheet.getRange(rowNum, estadoIdx + 1).setValue('Apelado');
    sheet.getRange(rowNum, obsIdx   + 1).setValue(obs);
    sheet.getRange(rowNum, fechaIdx + 1).setValue(fechaHoy);
    // Notificar a la secretaría
    try {
      const asunto = '[PQRS Goyavier] El solicitante registró una observación · ' + id;
      const cuerpo =
        'El solicitante no quedó satisfecho con la respuesta recibida y ha registrado una observación o inconformidad sobre la solicitud ' + id + '.\n\n' +
        'Observación del solicitante:\n' + obs + '\n\n' +
        'El caso ha pasado al estado "Apelado". Por favor ingrese al sistema PQRS para revisar la observación,\n' +
        'comunicarla al área responsable y hacer el seguimiento correspondiente.\n\n' +
        'Recuerde que el solicitante está esperando una nueva respuesta que atienda su inconformidad.\n\n' +
        'Con atención,\nSistema PQRS · Colegio Goyavier Campestre';
      notificarBandeja_(bandejaDeFilaArray_(headers, data[rowNum - 1]), asunto, cuerpo);
    } catch(mailErr) {
      Logger.log('Error correo secretaría: ' + mailErr.message);
    }
    // NO se envía correo automático al área — Secretaría debe revisarlo en la app
    // y enviarlo manualmente desde el botón "Enviar observación al área".
    // Registrar observación en la línea de tiempo
    try {
      const nombreIdx2 = headers.indexOf('Nombre');
      const nombreSol2 = nombreIdx2 >= 0 ? String(data[rowNum - 1][nombreIdx2] || '') : '';
      const segSheet2  = ss.getSheetByName(SEG_SHEET) || ss.insertSheet(SEG_SHEET);
      segSheet2.appendRow([id, fechaHoy, obs, 'Apelado', new Date().toISOString(), 'observacion_solicitante', nombreSol2 || 'Solicitante', Utilities.getUuid()]);
    } catch(segErr2) { Logger.log('Seg obs err: ' + segErr2.message); }
    return jsonOut({ok: true});
  } catch(err) {
    return jsonOut({ok: false, error: err.message});
  }
}

function cerrarPqrsSolicitanteJson_(p) {
  const id  = String(p.id  || '').trim();
  const tkn = String(p.tkn || '').trim();
  const cal = Math.min(5, Math.max(0, parseInt(p.calificacion || '0') || 0)); // 1–5
  if (!id) return jsonOut({ok: false, error: 'ID requerido'});
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return jsonOut({ok: false, error: 'Hoja no encontrada'});
    const data    = sheet.getDataRange().getValues();
    const headers = data[0].map(String);
    const idIdx     = headers.indexOf('ID');
    const estadoIdx = headers.indexOf('Estado');
    const tknIdx    = headers.indexOf('TokenRespuesta');
    var rowNum = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]).trim() === id) { rowNum = i + 1; break; }
    }
    if (rowNum < 0) return jsonOut({ok: false, error: 'Solicitud no encontrada'});
    const tokenGuardado = tknIdx >= 0 ? String(data[rowNum - 1][tknIdx] || '').trim() : '';
    if (!tkn || !tokenGuardado || tkn !== tokenGuardado) {
      return jsonOut({ok: false, error: 'Este enlace ya fue utilizado. Te enviaremos uno nuevo cuando tengamos novedades de tu caso.'});
    }
    const estadoActual = String(data[rowNum - 1][estadoIdx] || '');
    if (estadoActual === 'Cerrado') return jsonOut({ok: false, error: 'La solicitud ya esta cerrada.'});
    _actualizarTokenRespuesta_(id, '');
    sheet.getRange(rowNum, estadoIdx + 1).setValue('Cerrado');
    // Guardar calificación en columna Calificacion
    if (cal >= 1 && cal <= 5) {
      let calIdx = headers.indexOf('Calificacion');
      if (calIdx < 0) {
        calIdx = headers.length;
        sheet.getRange(1, calIdx + 1).setValue('Calificacion').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      }
      sheet.getRange(rowNum, calIdx + 1).setValue(cal);
    }
    const nombreCierre = headers.indexOf('Nombre') >= 0 ? String(data[rowNum - 1][headers.indexOf('Nombre')] || '') : '';
    // Registrar cierre en la línea de tiempo
    try {
      const segSheetCierre = ss.getSheetByName(SEG_SHEET) || ss.insertSheet(SEG_SHEET);
      const fechaCierre = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      const calTexto = cal >= 1 ? ' Calificación otorgada: ' + cal + '/5 estrellas.' : '';
      segSheetCierre.appendRow([id, fechaCierre,
        'El solicitante confirmó que su solicitud fue atendida satisfactoriamente y solicitó el cierre del caso.' + calTexto,
        'Cerrado', new Date().toISOString(), 'cierre_solicitante', nombreCierre || 'Solicitante', Utilities.getUuid()]);
    } catch(segErrCierre) { Logger.log('Seg cierre err: ' + segErrCierre.message); }
    try {
      const asunto = '[PQRS Goyavier] Caso cerrado por el solicitante · ' + id;
      const calInfo = cal >= 1 ? '\nCalificación otorgada: ' + cal + '/5 estrellas.' : '';
      const cuerpo = 'El solicitante confirmó que su solicitud ' + id + ' fue atendida de manera satisfactoria y procedió a cerrar su caso.' + calInfo + '\n\nNo se requiere ninguna acción adicional. ¡Buena gestión!';
      notificarBandeja_(bandejaDeFilaArray_(headers, data[rowNum - 1]), asunto, cuerpo);
    } catch(mailErr) {
      Logger.log('Error correo cierre: ' + mailErr.message);
    }
    return jsonOut({ok: true});
  } catch(err) {
    return jsonOut({ok: false, error: err.message});
  }
}

// Versión JSON de guardarRespuestaArea_ (para fetch desde el formulario público del área)
function guardarRespuestaAreaJson_(p) {
  const id    = String(p.id    || '').trim();
  const area  = String(p.area  || '').trim().slice(0, 200);
  const obs   = String(p.obs   || '').trim().slice(0, 5000);
  const nonce = String(p.nonce || '').trim();
  if (!id || !obs) return jsonOut({ok: false, error: 'Datos incompletos.'});
  try {
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const segSheet = ss.getSheetByName(SEG_SHEET) || ss.insertSheet(SEG_SHEET);
    const segHeaders = ['PQRS_ID','Fecha','Respuesta','Estado','RegistradoEn','Tipo','Autor','SegKey'];
    if (segSheet.getLastRow() === 0) {
      segSheet.appendRow(segHeaders);
      segSheet.getRange(1,1,1,segHeaders.length).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
    } else {
      const existH = segSheet.getRange(1, 1, 1, segSheet.getLastColumn()).getValues()[0];
      if (existH.indexOf('Tipo') < 0) {
        const tc = existH.length + 1;
        segSheet.getRange(1, tc  ).setValue('Tipo' ).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
        segSheet.getRange(1, tc+1).setValue('Autor').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      }
      if (existH.indexOf('SegKey') < 0) {
        const skc = segSheet.getLastColumn() + 1;
        segSheet.getRange(1, skc).setValue('SegKey').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      }
    }
    // Dedup: si ya existe un seguimiento con el mismo nonce para este PQRS, no insertar de nuevo
    if (nonce && segSheet.getLastRow() >= 2) {
      const segData   = segSheet.getDataRange().getValues();
      const segHdrs   = segData[0];
      const segKeyCol = segHdrs.indexOf('SegKey');
      const targetKey = id + '_' + nonce;
      for (let i = 1; i < segData.length; i++) {
        if (String(segData[i][segKeyCol] || '') === targetKey) {
          return jsonOut({ok: true, duplicate: true});
        }
      }
    }
    const fechaHoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const ahora    = new Date().toISOString();
    const segKey   = nonce ? id + '_' + nonce : '';
    segSheet.appendRow([id, fechaHoy, obs, 'Proceso', ahora, 'area', area, segKey]);
    // Notificar a Secretaría para que revise y apruebe antes de enviar al solicitante
    try {
      const esObservacion = String(p.tipo || '').toLowerCase() === 'observacion';
      const asuntoSec = esObservacion
        ? '[PQRS Goyavier] ' + area + ' respondió a la observación del solicitante · ' + id
        : '[PQRS Goyavier] ' + area + ' registró respuesta a la solicitud · ' + id;
      const cuerpoSec = esObservacion
        ? 'El equipo de ' + area + ' ha revisado la observación o inconformidad registrada por el solicitante ' +
          'en la solicitud ' + id + ' y ha generado una nueva respuesta relacionada con dicha observación.\n\n' +
          'Nueva respuesta del área:\n' + obs + '\n\n' +
          'Por favor ingrese al sistema PQRS para revisar esta respuesta y, si es adecuada, enviarla oficialmente al solicitante.\n' +
          'Recuerde que el solicitante está a la espera de una respuesta a su observación.\n\n' +
          'Importante: Esta respuesta aún no ha sido enviada al solicitante. Solo el personal autorizado del sistema PQRS puede hacerlo desde la aplicación.\n\n' +
          'Con atención,\nSistema PQRS · Colegio Goyavier Campestre'
        : 'El equipo de ' + area + ' acaba de registrar su respuesta a la solicitud ' + id + '.\n\n' +
          'Respuesta del área:\n' + obs + '\n\n' +
          'Por favor ingrese al sistema PQRS para revisar esta respuesta y, si es adecuada, enviarla oficialmente al solicitante.\n\n' +
          'Importante: Esta respuesta aún no ha sido enviada al solicitante. Solo el personal autorizado del sistema PQRS puede hacerlo desde la aplicación.\n\n' +
          'Con atención,\nSistema PQRS · Colegio Goyavier Campestre';
      notificarBandeja_(bandejaDePqrsId_(ss, id), asuntoSec, cuerpoSec);
    } catch(mailErr) {
      Logger.log('Error correo secretaria: ' + mailErr.message);
    }
    return jsonOut({ok: true});
  } catch(err) {
    return jsonOut({ok: false, error: err.message});
  }
}

// Envía un correo usando el access_token de Google del usuario autenticado.
// Si el token expiró lanza Error('TOKEN_EXPIRED') para que el cliente sepa.
// Fallback: si no hay token, usa GmailApp (cuenta del dueño del script).
function sendViaGmailApi_(accessToken, to, subject, body, opts) {
  var fromName = (opts && opts.name)    ? opts.name    : 'PQRS Colegio Goyavier';
  var replyTo  = (opts && opts.replyTo) ? opts.replyTo : '';
  // Construir mensaje RFC 2822 con el cuerpo en base64
  var lines = [
    'To: ' + to,
    'Subject: =?UTF-8?B?' + Utilities.base64Encode(subject, Utilities.Charset.UTF_8) + '?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ];
  if (fromName) lines.unshift('From: "' + fromName.replace(/"/g, "'") + '" <me>');
  if (replyTo)  lines.push('Reply-To: ' + replyTo);
  lines.push('');
  lines.push(Utilities.base64Encode(body, Utilities.Charset.UTF_8));
  var rawMsg      = lines.join('\r\n');
  var encodedMsg  = Utilities.base64EncodeWebSafe(rawMsg);
  var response = UrlFetchApp.fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + accessToken },
      payload: JSON.stringify({ raw: encodedMsg }),
      muteHttpExceptions: true
    }
  );
  var code = response.getResponseCode();
  if (code === 401 || code === 403) throw new Error('TOKEN_EXPIRED');
  if (code !== 200) throw new Error('Gmail API ' + code + ': ' + response.getContentText().slice(0, 200));
  return true;
}

// Login tradicional — busca usuario en UsuariosPQRS por email (o prefijo) + columna Clave.
// Mensaje cuando un usuario autorizado todavía no tiene perfil en la hoja UsuariosPQRS.
const ERROR_SIN_PERFIL = 'Su usuario no tiene un perfil asignado (Secretaria, Talento Humano o Rectoria). Contacte al administrador.';

function login_(usuario, clave) {
  // Rate limiting: máx 5 intentos fallidos por IP/usuario en 15 minutos
  var cache = CacheService.getScriptCache();
  var rlKey = 'pqrs_rl_' + String(usuario || '').toLowerCase().trim().slice(0, 60);
  var attempts = parseInt(cache.get(rlKey) || '0', 10);
  if (attempts >= 5) return jsonOut({ok: false, error: 'Demasiados intentos. Por favor, intente de nuevo en 15 minutos.'});

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(USUARIOS_SHEET);
  if (!sheet || sheet.getLastRow() < 2)
    return jsonOut({ok: false, error: 'Sistema no inicializado. Ejecute inicializarSistema().'});
  var data    = sheet.getDataRange().getValues();
  var hdrs    = data[0].map(function(h){ return String(h).trim(); });
  var emailCol = hdrs.indexOf('Email');
  var nombreCol= hdrs.indexOf('Nombre');
  var estadoCol= hdrs.indexOf('Estado');
  var claveCol = hdrs.indexOf('Clave');
  var perfilCol= hdrs.indexOf('Perfil');
  if (emailCol < 0) return jsonOut({ok: false, error: 'Hoja UsuariosPQRS sin columna Email.'});
  if (claveCol < 0) return jsonOut({ok: false, error: 'Hoja UsuariosPQRS sin columna Clave. Ejecute inicializarSistema().'});
  var u = String(usuario || '').toLowerCase().trim();
  var found = null;
  for (var i = 1; i < data.length; i++) {
    var email  = String(data[i][emailCol] || '').toLowerCase().trim();
    var prefix = email.split('@')[0];
    if (email === u || prefix === u) {
      found = {
        email:  email,
        nombre: nombreCol >= 0 ? String(data[i][nombreCol] || email).trim() : email,
        estado: estadoCol >= 0 ? String(data[i][estadoCol] || 'ACTIVO').trim().toUpperCase() : 'ACTIVO',
        clave:  claveCol  >= 0 ? String(data[i][claveCol]  || '') : '',
        perfil: perfilCol >= 0 ? normPerfil_(data[i][perfilCol]) : ''
      };
      break;
    }
  }
  // Mensaje genérico para evitar enumeración de usuarios/claves
  if (!found || found.clave !== String(clave || '')) {
    cache.put(rlKey, String(attempts + 1), 900);
    return jsonOut({ok: false, error: 'Credenciales inválidas.'});
  }
  if (found.estado !== 'ACTIVO') return jsonOut({ok: false, error: 'Usuario inactivo. Contacte al administrador.'});
  if (!found.perfil) return jsonOut({ok: false, error: ERROR_SIN_PERFIL});
  cache.remove(rlKey);
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('pqrs_token_' + token, JSON.stringify({
    usuario: found.email, email: found.email, nombre: found.nombre, role: found.perfil, perfil: found.perfil,
    createdAt: new Date().toISOString()
  }), 21600);
  return jsonOut({ok: true, token: token, usuario: found.email, email: found.email, nombre: found.nombre, role: found.perfil, perfil: found.perfil});
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('pqrs_token_' + String(token));
  return jsonOut({ok: true});
}

// Autenticación con Google — mismo patrón que Zaiko y Paz y Salvo.
// El cliente envía el access_token obtenido via oauth2.initTokenClient.
// GAS lo valida con la userinfo API de Google, luego comprueba el email
// contra la hoja UsuariosPQRS (creada por inicializarSistema) y toma de ahí su Perfil.
function googleLogin_(accessToken) {
  if (!accessToken) return jsonOut({ok: false, error: 'Token no recibido.'});
  try {
    // 1. Verificar access_token con Google userinfo API
    var resp = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { 'Authorization': 'Bearer ' + accessToken }, muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return jsonOut({ok: false, error: 'Token de Google inválido o expirado.'});
    var info = JSON.parse(resp.getContentText());
    if (!info.email) return jsonOut({ok: false, error: 'No se pudo obtener el correo de Google.'});
    var email = String(info.email).toLowerCase().trim();

    // 2. Verificar contra la hoja UsuariosPQRS
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var usuSheet = ss.getSheetByName(USUARIOS_SHEET);
    if (!usuSheet || usuSheet.getLastRow() < 2) {
      return jsonOut({ok: false, error: 'Sistema no inicializado. Ejecute inicializarSistema() desde Apps Script.'});
    }
    var usuData   = usuSheet.getDataRange().getValues();
    var usuHdrs   = usuData[0].map(function(h) { return String(h).trim(); });
    var emailCol  = usuHdrs.indexOf('Email');
    var nombreCol = usuHdrs.indexOf('Nombre');
    var estadoCol = usuHdrs.indexOf('Estado');
    var perfilCol = usuHdrs.indexOf('Perfil');
    if (emailCol < 0) return jsonOut({ok: false, error: 'Hoja UsuariosPQRS mal configurada (falta columna Email).'});

    var found = null;
    for (var i = 1; i < usuData.length; i++) {
      if (String(usuData[i][emailCol] || '').toLowerCase().trim() === email) {
        found = {
          email:  email,
          nombre: nombreCol >= 0 ? String(usuData[i][nombreCol] || email).trim() : email,
          estado: estadoCol >= 0 ? String(usuData[i][estadoCol] || 'ACTIVO').trim().toUpperCase() : 'ACTIVO',
          perfil: perfilCol >= 0 ? normPerfil_(usuData[i][perfilCol]) : ''
        };
        break;
      }
    }
    if (!found)                    return jsonOut({ok: false, error: 'Correo no autorizado: ' + email});
    if (found.estado !== 'ACTIVO') return jsonOut({ok: false, error: 'Usuario inactivo. Contacte al administrador.'});
    if (!found.perfil)             return jsonOut({ok: false, error: ERROR_SIN_PERFIL});

    // 3. Emitir token de sesión (6 h)
    var sessionToken = Utilities.getUuid();
    CacheService.getScriptCache().put('pqrs_token_' + sessionToken, JSON.stringify({
      usuario: found.email,
      email:   found.email,
      nombre:  found.nombre,
      role:    found.perfil,
      perfil:  found.perfil,
      createdAt: new Date().toISOString()
    }), 21600);
    return jsonOut({ok: true, token: sessionToken, usuario: found.email, email: found.email, nombre: found.nombre, role: found.perfil, perfil: found.perfil});
  } catch(err) {
    return jsonOut({ok: false, error: 'Error al verificar con Google: ' + err.message});
  }
}

// Envía manualmente la observación del solicitante al área responsable.
// Solo puede llamarse desde la app (requiere token de sesión autenticado).
// Construye un correo completo con todos los datos del PQRS y el link de respuesta.
function enviarObsArea_(p, auth) {
  const id          = String(p.id          || '').trim();
  const extraMsg    = String(p.extraMsg    || '').trim();
  const googleToken = String(p.googleToken || '').trim();
  if (!id) return jsonOut({ok: false, error: 'ID de PQRS requerido.'});

  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return jsonOut({ok: false, error: 'Hoja PQRS no encontrada.'});

    const data    = sheet.getDataRange().getValues();
    const hdrs    = data[0];
    const col     = function(n) { return hdrs.indexOf(n); };
    const pqrsRow = data.slice(1).find(function(r) { return String(r[col('ID')] || '').trim() === id; });
    if (!pqrsRow) return jsonOut({ok: false, error: 'Solicitud ' + id + ' no encontrada.'});
    const bandeja = bandejaDeFilaArray_(hdrs, pqrsRow);
    if (!auth || !perfilVeBandeja_(auth.perfil, bandeja)) return jsonOut({ok: false, error: 'No tiene acceso a esta solicitud.'});

    const get = function(field) { var c = col(field); return c >= 0 ? String(pqrsRow[c] || '').trim() : ''; };
    const dep          = get('Dependencia');
    const nombreSol    = get('Nombre')              || 'el solicitante';
    const correoSol    = get('Correo')              || '';
    const estudiante   = get('Estudiante');
    const grado        = get('Grado');
    const tipo         = get('TipoSolicitud')       || '';
    const descripcion  = get('Descripcion')         || '';
    const estado       = get('Estado')              || '';
    const fechaCreacion= get('CreadoEn')            || get('FechaCreacion') || '';
    const fechaObs     = get('FechaObservacion')    || '';
    const obsTexto     = get('ObservacionSolicitante');

    if (!obsTexto) return jsonOut({ok: false, error: 'Esta solicitud no tiene observación registrada.'});
    if (!dep)      return jsonOut({ok: false, error: 'La solicitud no tiene dependencia asignada.'});

    const cfg       = readConfigObject_();
    const emailArea = String((cfg.emailAreas || {})[dep] || '').trim();
    if (!emailArea) return jsonOut({ok: false, error: 'La dependencia "' + dep + '" no tiene correo configurado. Configúrelo en la sección de Configuración.'});

    // Recuperar seguimientos previos del área para dar contexto
    const segSheet = ss.getSheetByName(SEG_SHEET);
    var historialTexto = '';
    if (segSheet && segSheet.getLastRow() >= 2) {
      const segData = segSheet.getDataRange().getValues();
      const sHdrs   = segData[0];
      const sIdCol  = sHdrs.indexOf('PQRS_ID');
      const sFecha  = sHdrs.indexOf('Fecha');
      const sResp   = sHdrs.indexOf('Respuesta');
      const sTipo   = sHdrs.indexOf('Tipo');
      const prevSegs = segData.slice(1)
        .filter(function(r) { return String(r[sIdCol] || '').trim() === id; })
        .map(function(r) {
          var t = sTipo >= 0 ? String(r[sTipo] || '') : '';
          var f = sFecha >= 0 ? String(r[sFecha] || '') : '';
          var resp = sResp >= 0 ? String(r[sResp] || '') : '';
          return '  [' + (t || 'seguimiento') + '] ' + f + ':\n  ' + resp;
        });
      if (prevSegs.length) historialTexto = '\n\nHISTORIAL DE SEGUIMIENTOS:\n' + prevSegs.join('\n\n');
    }

    // Construir enlace de respuesta específico para esta observación
    const enlaceRespuesta = ScriptApp.getService().getUrl() +
      '?action=responderArea&id='   + encodeURIComponent(id) +
      '&area=' + encodeURIComponent(dep) +
      '&tipo=observacion';

    const remitente  = auth && auth.nombre ? auth.nombre : (NOMBRE_BANDEJA[bandeja] || 'Secretaría');
    const asunto     = '[PQRS Goyavier] Observación del solicitante — Solicitud ' + id + ' — ' + dep;
    const cuerpo     =
      'Hola, equipo de ' + dep + '.\n\n' +
      'Les informamos que el solicitante ha registrado una observación o inconformidad\n' +
      'con respecto a la respuesta anterior sobre este caso.\n' +
      'Esta comunicación fue revisada por ' + remitente + ' y se les envía para su atención oportuna.\n\n' +
      '══════════════════════════════════════════\n' +
      'DATOS DE LA SOLICITUD\n' +
      '══════════════════════════════════════════\n' +
      '  ID / Consecutivo : ' + id + '\n' +
      '  Tipo de solicitud: ' + tipo + '\n' +
      '  Estado actual    : ' + estado + '\n' +
      '  Fecha de creación: ' + fechaCreacion + '\n' +
      '  Dependencia      : ' + dep + '\n' +
      '  Solicitante      : ' + nombreSol + (correoSol ? ' <' + correoSol + '>' : '') + '\n' +
      '  Tipo de solicitante: ' + (get('TipoSolicitante') || '-') + '\n' +
      (estudiante ? '  Estudiante       : ' + estudiante + '\n' : '') +
      (grado ? '  Grado            : ' + grado + '\n' : '') + '\n' +
      '══════════════════════════════════════════\n' +
      'DESCRIPCIÓN ORIGINAL DEL PQRS\n' +
      '══════════════════════════════════════════\n' +
      descripcion + '\n' +
      historialTexto + '\n\n' +
      '══════════════════════════════════════════\n' +
      'OBSERVACIÓN / INCONFORMIDAD DEL SOLICITANTE\n' +
      (fechaObs ? '(Registrada el ' + fechaObs + ')\n' : '') +
      '══════════════════════════════════════════\n' +
      obsTexto + '\n' +
      (extraMsg ? '\n──────────────────────────────────────────\nComentario de ' + remitente + ':\n' + extraMsg + '\n' : '') +
      '\n══════════════════════════════════════════\n' +
      'Por favor registren su respuesta a esta observación haciendo clic en el siguiente enlace:\n\n' +
      enlaceRespuesta + '\n\n' +
      '══════════════════════════════════════════\n' +
      'Importante: Su respuesta llegará primero al sistema. El equipo de PQRS la\n' +
      'revisará antes de comunicarla oficialmente al solicitante.\n\n' +
      'Con atención y agradecimiento,\n' + remitente + '\nColegio Goyavier Campestre · Sistema PQRS';

    const opts = {name: 'PQRS Colegio Goyavier', replyTo: correoDeBandeja_(bandeja)};
    var viaEnvio = 'gmailapp';
    if (googleToken) {
      try {
        sendViaGmailApi_(googleToken, emailArea, asunto, cuerpo, opts);
        viaEnvio = 'gmail_api';
      } catch(gmailErr) {
        if (gmailErr.message === 'TOKEN_EXPIRED') return jsonOut({ok: false, error: 'TOKEN_EXPIRED'});
        GmailApp.sendEmail(emailArea, asunto, cuerpo, opts);
      }
    } else {
      GmailApp.sendEmail(emailArea, asunto, cuerpo, opts);
    }
    return jsonOut({ok: true, to: emailArea, via: viaEnvio});
  } catch(err) {
    return jsonOut({ok: false, error: err.message});
  }
}

function jsonOut(data) {
  const json = JSON.stringify(data);
  if (_jsonpCb_) {
    return ContentService.createTextOutput(_jsonpCb_ + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// Ejecutar UNA SOLA VEZ en una instalación NUEVA desde el editor de Apps Script:
//   Funciones → inicializarSistema → Ejecutar
// Crea las hojas con sus valores por defecto. No toca nada que ya exista (ni la
// configuración ni los usuarios): para actualizar un sistema que ya funciona use
// actualizarEstructura().
// ============================================================
function inicializarSistema() {
  actualizarEstructura();
}

// Solicitudes ya importadas antes del cambio no tienen TipoSolicitante, pero la hoja de respuestas del formulario
// sí puede traer la columna «¿Cuál es tu relación con el colegio?» llena (p. ej. rellenada a mano en las respuestas
// antiguas). Se copia SOLO a las filas de PQRS que tienen el tipo vacío, enlazando por FormsID (FormsKey) y
// siempre por NOMBRE de columna: da igual en qué posición esté la columna. Devuelve las solicitudes completadas.
function completarTipoDesdeForms_(ss) {
  const pqrs = ss.getSheetByName(SHEET_NAME), forms = ss.getSheetByName(FORMS_SHEET);
  if (!pqrs || !forms || pqrs.getLastRow() < 2 || forms.getLastRow() < 2) return [];
  const fd = forms.getDataRange().getValues();
  const fh = fd[0];
  const iRel = fh.findIndex(function(h) {
    const n = normKey_(h);
    return CAMPOS_TIPO_SOLICITANTE.some(function(c) { return normKey_(c) === n; }) ||
           CLAVES_PARCIALES_SOLICITANTE.some(function(p) { return n.indexOf(p) >= 0; });
  });
  if (iRel < 0) return [];
  const iFid = fh.indexOf('FormsID');
  const tipoPorClave = {};
  fd.slice(1).forEach(function(r) {
    const tipo = normTipoSolicitante_(r[iRel]);
    if (!tipo) return;
    const clave = (iFid >= 0 && String(r[iFid] || '').trim()) ? String(r[iFid]).trim() : normalizeTimestamp_(r[0]);
    if (clave) tipoPorClave[clave] = tipo;
  });
  const hechas = [];
  conBloqueo_(function() {
    const pd = pqrs.getDataRange().getValues();
    const ph = pd[0].map(function(h) { return String(h).trim(); });
    const iT = ph.indexOf('TipoSolicitante'), iK = ph.indexOf('FormsKey'), iId = ph.indexOf('ID');
    if (iT < 0 || iK < 0) return;
    for (let i = 1; i < pd.length; i++) {
      if (String(pd[i][iT] || '').trim()) continue;                 // ya tiene tipo: no se toca
      const tipo = tipoPorClave[String(pd[i][iK] || '').trim()];
      if (!tipo) continue;
      pqrs.getRange(i + 1, iT + 1).setValue(tipo);
      hechas.push(String(pd[i][iId]).trim() + ' (' + tipo + ')');
    }
  });
  return hechas;
}

// ============================================================
// Ejecutar UNA VEZ después de pegar esta versión del código (también sirve en instalaciones nuevas):
//   Funciones → actualizarEstructura → Ejecutar
//  · Agrega a la hoja PQRS las columnas nuevas (TipoSolicitante, etc.) SIN mover ni borrar las que ya hay.
//  · Agrega la columna «Perfil» a UsuariosPQRS y lista los usuarios que todavía no tienen perfil.
//  · Agrega a Configuracion los correos por perfil (emailPerfiles) y copiarRectoria si no existían.
//  · Completa el tipo de solicitante de las solicitudes antiguas que no lo tienen, a partir de la hoja de respuestas.
// Es seguro repetirla: solo agrega lo que falta.
// ============================================================
function actualizarEstructura() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const avisos = [];

  // Hoja PQRS
  let pqrsSheet = ss.getSheetByName(SHEET_NAME);
  if (!pqrsSheet) pqrsSheet = ss.insertSheet(SHEET_NAME);
  ensureHeaders(pqrsSheet);

  // Hoja Seguimientos
  let segSheet = ss.getSheetByName(SEG_SHEET);
  if (!segSheet) segSheet = ss.insertSheet(SEG_SHEET);
  ensureSegHeaders_(segSheet);

  // Hoja Configuracion: solo se siembra lo que falta (antes se borraba todo al volver a ejecutar)
  let cfgSheet = ss.getSheetByName(CFG_SHEET);
  if (!cfgSheet) {
    cfgSheet = ss.insertSheet(CFG_SHEET);
    cfgSheet.appendRow(['Clave', 'Valor']);
    estiloEncabezado_(cfgSheet.getRange(1, 1, 1, 2));
  }
  const cfgActual = readConfigObject_();
  const configDefecto = {
    diasRespuesta: 15,
    alertaDias: 2,
    emailAreas: {},
    dependencias: [
      'Coord. Preescolar','Coord. Academica','Bachillerato','Mantenimiento',
      'Servicio de restaurante','Coord. Primaria','Coord. Convivencia',
      'Secretaria','Servicios Varios','Biblioteca','Sistemas','Enfermeria'
    ],
    // Correos que reciben los avisos de cada bandeja (se pueden cambiar en Configuración). Vacío = EMAIL_RESP.
    // copiarRectoria: Rectoría recibe copia solo cuando llega una solicitud NUEVA.
    emailPerfiles: { secretaria: EMAIL_RESP, talentoHumano: 'talentohumano@colegiogoyavier.edu.co', rectoria: 'rectoria@colegiogoyavier.edu.co' },
    copiarRectoria: true
  };
  Object.keys(configDefecto).forEach(function(k) {
    if (cfgActual[k] === undefined) {
      cfgSheet.appendRow([k, JSON.stringify(configDefecto[k])]);
      avisos.push('Configuracion: se agregó «' + k + '».');
    }
  });

  // Hoja UsuariosPQRS — usuarios autorizados y su perfil
  let usuSheet = ss.getSheetByName(USUARIOS_SHEET);
  if (!usuSheet) {
    usuSheet = ss.insertSheet(USUARIOS_SHEET);
    usuSheet.appendRow(['Email', 'Nombre', 'Estado', 'Clave', 'Perfil']);
    estiloEncabezado_(usuSheet.getRange(1, 1, 1, 5));
  }
  const uh = usuSheet.getRange(1, 1, 1, usuSheet.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
  ['Clave', 'Perfil'].forEach(function(col) {
    if (uh.indexOf(col) < 0) {
      estiloEncabezado_(usuSheet.getRange(1, uh.length + 1).setValue(col));
      uh.push(col);
      avisos.push('UsuariosPQRS: se agregó la columna «' + col + '».');
    }
  });
  // Los usuarios y claves se gestionan directamente en la hoja UsuariosPQRS — no se insertan desde el código.
  if (usuSheet.getLastRow() >= 2) {
    const iE = uh.indexOf('Email'), iP = uh.indexOf('Perfil');
    const sinPerfil = usuSheet.getRange(2, 1, usuSheet.getLastRow() - 1, uh.length).getValues()
      .filter(function(r) { return String(r[iE] || '').trim() && !normPerfil_(r[iP]); })
      .map(function(r) { return String(r[iE]).trim(); });
    if (sinPerfil.length) avisos.push('FALTA asignar «Perfil» (Secretaria, Talento Humano o Rectoria) a: ' + sinPerfil.join(', ') +
      '. Mientras no lo tengan NO podrán iniciar sesión.');
  }

  // Solicitudes antiguas sin tipo: se completa con la columna de relación de la hoja de respuestas (si la tienen llena)
  const completadas = completarTipoDesdeForms_(ss);
  if (completadas.length) avisos.push('PQRS: se completó «TipoSolicitante» en ' + completadas.length + ' solicitud(es) antigua(s) desde la hoja de respuestas: ' + completadas.join(', ') + '.');

  Logger.log('✓ Estructura PQRS actualizada.\n' + (avisos.length ? avisos.join('\n') : 'No había nada pendiente.') +
    '\nRecuerde: en el Google Form debe existir la pregunta «¿Cuál es tu relación con el colegio?».');
}
