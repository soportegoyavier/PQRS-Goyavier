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

// Escapa caracteres HTML para evitar XSS al insertar datos de Sheets en HTML generado.
function sanitizeHtml_(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function onFormSubmit(e) {
  try {
    if (!e || !e.namedValues) {
      Logger.log('onFormSubmit: evento no válido. Esta función debe ejecutarse mediante el activador "Al enviar formulario", no manualmente desde el editor.');
      return;
    }
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    ensureHeaders(sheet);
    const r = e.namedValues;

    // Leer cabeceras reales de la hoja Forms para mapeo robusto de campos
    const formsSheet = ss.getSheetByName(FORMS_SHEET);
    const fHeaders = formsSheet && formsSheet.getLastRow() >= 1
      ? formsSheet.getRange(1, 1, 1, formsSheet.getLastColumn()).getValues()[0]
      : [];
    const fVals = e.values || [];

    // get(): 3 niveles — exacto en namedValues → normalizado en namedValues → por header+posición en hoja Forms
    const normKey_ = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
    const get = (...keys) => {
      for(const k of keys) { if(r[k] && r[k][0].trim()) return r[k][0].trim(); }
      for(const k of keys) {
        const nk = normKey_(k);
        for(const [rk, rv] of Object.entries(r)) {
          if(normKey_(rk) === nk && rv && rv[0].trim()) return rv[0].trim();
        }
      }
      return getFormValue_(fHeaders, fVals, keys, -1);
    };

    const formTimestamp = e.values && e.values[0] instanceof Date ? e.values[0].toISOString() : new Date().toISOString();
    const fecha      = formTimestamp.slice(0, 10);
    const id         = generarId(sheet);
    const nombre     = get('Nombre completo', 'Nombre', 'Nombres', 'Nombre del solicitante', 'Nombre y apellidos');
    const correo     = get('Correo electrónico', 'Correo electronico', 'Correo', 'Email', 'E-mail');
    const telefono   = get('Teléfono', 'Telefono', 'Celular', 'Móvil', 'Movil', 'Tel');
    const estudiante = get('Nombre del estudiante', 'Estudiante', 'Nombre estudiante', 'Nombre del hijo', 'Nombre del hijo/a');
    const tiposol    = get('Tipo de solicitud', 'Tipo de Solicitud', 'Tipo PQRS', 'Tipo', 'Categoría', 'Categoria');
    const requiere   = get('Requiere respuesta', 'Requiere Respuesta') || 'Si';
    const descripcion= get('Descripción de la solicitud', 'Descripcion de la solicitud', 'Descripción', 'Descripcion', 'Mensaje', 'Detalle', 'Detalle de la solicitud', 'Su solicitud');
    const grado      = get('Grado', 'Grado del estudiante', 'Curso', 'Grado/Curso', 'Grado o curso');
    const medio      = 'Forms';

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

    const headers = getHeaders();
    const rowData = headers.map(h => {
      const map = {
        ID: id, Fecha: fecha, Dependencia: '',
        Nombre: nombre, Telefono: telefono, Correo: correo,
        Estudiante: estudiante, Grado: grado, TipoSolicitud: tiposol,
        MedioRecepcion: medio, RequiereRespuesta: requiere,
        Descripcion: descripcion, Estado: 'Borrador',
        EmailPendiente: 'FALSE', CreadoEn: formTimestamp,
        OrigenForms: 'TRUE', FormsKey: formsId
      };
      return map[h] !== undefined ? map[h] : '';
    });
    sheet.appendRow(rowData);
    const asunto = '[PQRS Goyavier] Nueva solicitud desde Forms · ' + id;
    const cuerpo = 'Nueva solicitud PQRS desde el formulario web.\\n\\nID: ' + id + '\\nFecha: ' + fecha + '\\nTipo: ' + tiposol + '\\nNombre: ' + nombre + '\\nEstudiante: ' + estudiante + '\\nGrado: ' + grado + '\\nDescripción: ' + descripcion;
    GmailApp.sendEmail(EMAIL_RESP, asunto, cuerpo);
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
    // Rutas públicas JSON (para fetch desde formularios de respuesta públicos)
    if (action === 'guardarRespuestaJson')     return guardarRespuestaSolicitanteJson_(e.parameter);
    if (action === 'guardarRespuestaAreaJson') return guardarRespuestaAreaJson_(e.parameter);
    if (action === 'cerrarPqrsJson')           return cerrarPqrsSolicitanteJson_(e.parameter);
    const auth = requireAuthorized_(e.parameter.token);
    if (!auth.ok) return jsonOut(auth);
    if (action === 'getData')        return getData();
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
    if (payload.action === 'sync')          return syncData(payload.data);
    if (payload.action === 'saveConfig')    return saveConfig(payload.config);
    if (payload.action === 'markFormsRow')  return markFormsRow(payload.timestamp);
    if (payload.action === 'sendResponseEmail') return sendResponseEmail(payload.solicitud, payload.seguimiento);
  } catch(err) {
    return jsonOut({error: err.message});
  }
}

function requireAuthorized_(token) {
  if (!token) return {ok: false, authorized: false, error: 'Sesión no iniciada.'};
  const raw = CacheService.getScriptCache().get('pqrs_token_' + token);
  if (!raw) return {ok: false, authorized: false, error: 'Sesión vencida. Inicie sesión nuevamente con Google.'};
  const data = JSON.parse(raw);
  return {ok: true, authorized: true, usuario: data.usuario, email: data.email, nombre: data.nombre, role: data.role};
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

function getData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pqrsSheet = ss.getSheetByName(SHEET_NAME);
  let pqrsRows = [];
  if (pqrsSheet && pqrsSheet.getLastRow() >= 2) {
    const data = pqrsSheet.getDataRange().getValues();
    const headers = data[0];
    pqrsRows = data.slice(1).filter(r => r[0]).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        const val = row[i];
        if (h === 'OrigenForms' || h === 'EmailPendiente') {
          const v = String(val);
          obj[h] = (v === 'TRUE' || v === 'true' || v === '1') ? 'TRUE' : 'FALSE';
        } else {
          obj[h] = val instanceof Date ? val.toISOString() : (val !== undefined ? String(val) : '');
        }
      });
      return obj;
    });
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
        registradoEn: row[4] instanceof Date ? row[4].toISOString() : String(row[4] || ''),
        tipo: String(row[5] || 'secretaria'),
        autor: String(row[6] || ''),
        segKey: String(row[7] || '')
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
      const correo      = getFormValue_(formsHeaders, row, ['Correo electrónico', 'Correo electronico', 'Correo', 'Email', 'E-mail'], 2);
      const telefono    = getFormValue_(formsHeaders, row, ['Teléfono', 'Telefono', 'Celular', 'Móvil', 'Movil', 'Tel'], 3);
      const estudiante  = getFormValue_(formsHeaders, row, ['Nombre del estudiante', 'Estudiante', 'Nombre estudiante', 'Nombre del hijo', 'Nombre del hijo/a'], 4);
      const tiposol     = getFormValue_(formsHeaders, row, ['Tipo de solicitud', 'Tipo de Solicitud', 'Tipo PQRS', 'Tipo', 'Categoría', 'Categoria'], 5);
      const requiere    = getFormValue_(formsHeaders, row, ['Requiere respuesta', 'Requiere Respuesta'], 6) || 'Si';
      const descripcion = getFormValue_(formsHeaders, row, ['Descripción de la solicitud', 'Descripcion de la solicitud', 'Descripción', 'Descripcion', 'Mensaje', 'Detalle', 'Detalle de la solicitud', 'Su solicitud'], 7);
      const grado       = getFormValue_(formsHeaders, row, ['Grado', 'Grado del estudiante', 'Curso', 'Grado/Curso', 'Grado o curso'], 8);

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
        TipoSolicitud: tiposol,
        MedioRecepcion:'Forms',
        RequiereRespuesta: requiere,
        Descripcion:   descripcion,
        Estado: 'Borrador', EmailPendiente: 'FALSE',
        CreadoEn: tsStr, OrigenForms: 'TRUE', FormsKey: formsId
      });
    });
  }
  let maxNum = 0;
  pqrsRows.forEach(r => {
    const n = parseInt(String(r.ID || '').replace('PQRS2260', '')) || 0;
    if (n > maxNum) maxNum = n;
  });
  pqrsRows.forEach(r => {
    if (!r.ID) {
      maxNum++;
      r.ID = 'PQRS2260' + String(maxNum).padStart(4, '0');
    }
  });
  // Adjuntar seguimientos a cada PQRS desde la hoja Seguimientos
  pqrsRows.forEach(r => {
    r.seguimientos = segMap[r.ID] || [];
  });
  return jsonOut(pqrsRows);
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

function getFormValue_(headers, row, names, fallbackIndex) {
  for (const name of names) {
    const idx = headers.indexOf(name);
    if (idx >= 0 && row[idx] !== undefined && String(row[idx]).trim()) return String(row[idx]).trim();
  }
  // Segundo intento: comparación sin acento/mayúsculas
  for (const name of names) {
    const norm = normalizeStr_(name);
    const idx = headers.findIndex(h => normalizeStr_(h) === norm);
    if (idx >= 0 && row[idx] !== undefined && String(row[idx]).trim()) return String(row[idx]).trim();
  }
  return row[fallbackIndex] !== undefined ? String(row[fallbackIndex]).trim() : '';
}

function syncData(solicitudes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  const segSheet = ss.getSheetByName(SEG_SHEET) || ss.insertSheet(SEG_SHEET);
  const headers = getHeaders();
  ensureHeaders(sheet);
  const segHeaders = ['PQRS_ID','Fecha','Respuesta','Estado','RegistradoEn','Tipo','Autor','SegKey'];
  if (segSheet.getLastRow() === 0) {
    segSheet.appendRow(segHeaders);
    segSheet.getRange(1, 1, 1, segHeaders.length).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
  } else {
    const existH = segSheet.getRange(1, 1, 1, segSheet.getLastColumn()).getValues()[0];
    if (existH.indexOf('Tipo') < 0) {
      const tc = existH.length + 1;
      segSheet.getRange(1, tc).setValue('Tipo').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
      segSheet.getRange(1, tc+1).setValue('Autor').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
    }
    if (existH.indexOf('SegKey') < 0) {
      const skc = segSheet.getLastColumn() + 1;
      segSheet.getRange(1, skc).setValue('SegKey').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
    }
  }
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow()-1, Math.max(sheet.getLastColumn(), headers.length)).clearContent();
  if (segSheet.getLastRow() > 1) segSheet.getRange(2, 1, segSheet.getLastRow()-1, Math.max(segSheet.getLastColumn(), segHeaders.length)).clearContent();
  solicitudes.forEach((s, i) => {
    sheet.getRange(i+2, 1, 1, headers.length).setValues([[
      s.id, s.fecha, s.dependencia||'', s.nombre||'', s.telefono||'', s.correo||'', s.estudiante||'', s.grado||'',
      s.tipoSolicitud||'', s.medioRecepcion||'', s.requiereRespuesta||'',
      s.descripcion||'', s.estado||'Borrador', s.emailPendiente ? 'TRUE' : 'FALSE',
      s.createdAt||'', s.origenForms ? 'TRUE' : 'FALSE',
      s.observacionSolicitante||'', s.fechaObservacion||'', s.formsKey||''
    ]]);
  });
  let segRow = 2;
  solicitudes.forEach(s => {
    (s.seguimientos || []).forEach(seg => {
      segSheet.getRange(segRow, 1, 1, segHeaders.length).setValues([[
        s.id, seg.fecha, seg.respuesta, seg.estado, seg.registradoEn || '',
        seg.tipo || 'secretaria', seg.autor || '', seg.segKey || ''
      ]]);
      segRow++;
    });
  });
  return jsonOut({ok: true, count: solicitudes.length});
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
  const asunto = sinEnlace
    ? '[Colegio Goyavier] Recibimos tu solicitud · ' + p.id
    : '[Colegio Goyavier] Tenemos novedades sobre tu solicitud · ' + p.id;
  // Cada envío genera un token único — al usarlo queda invalidado
  var tkn = '';
  var enlaceRespuesta = '';
  var bloqueEnlace = '';
  if (!sinEnlace) {
    tkn = Utilities.getUuid();
    _actualizarTokenRespuesta_(p.id, tkn);
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
  const contexto = String(p.contexto || 'respuesta');

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
      'Estudiante          : ' + (p.estudiante || '-') + '\n' +
      'Grado               : ' + (p.grado || '-') + '\n\n';
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
      'Estudiante          : ' + (p.estudiante || '-') + '\n' +
      'Grado               : ' + (p.grado || '-') + '\n\n' +
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
      'Estudiante          : ' + (p.estudiante || '-') + '\n' +
      'Grado               : ' + (p.grado || '-') + '\n\n' +
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
    'Tu bienestar y el de tu familia son muy importantes para nosotros.\n\n' +
    'Con mucho gusto te atendemos,\nEquipo PQRS · Colegio Goyavier Campestre';
  const opts = {name: 'PQRS Colegio Goyavier', replyTo: EMAIL_RESP};
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
    estudiante: solicitud.estudiante, grado: solicitud.grado,
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
      (obsSolic ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.6;color:#2d3748;"><b style="color:#92400e;display:block;margin-bottom:6px;">&#x26A0;&#xFE0F; El padre de familia registró una nueva observación:</b>' + sanitizeHtml_(obsSolic) + '</div>' : '') +
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
      '        document.querySelector(".card-body").innerHTML = \'<div style="text-align:center;padding:30px 0;"><div style="font-size:48px;margin-bottom:16px;">&#x2705;</div><h2 style="color:#0d5a96;margin-bottom:10px;">¡Respuesta registrada!</h2><p style="color:#718096;font-size:14px;line-height:1.7;">¡Gracias por tu gestión! La respuesta a la solicitud <strong>' + id + '</strong> fue registrada exitosamente.<br><br>Secretaría Académica la revisará y la enviará al solicitante a la brevedad. Tu aporte es fundamental para brindar la mejor atención a nuestras familias.</p></div>\';' +
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
      'Secretaría Académica la revisará y la enviará al solicitante a la brevedad. Tu aporte es fundamental para brindar la mejor atención a nuestras familias.</p>' +
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
        'Gracias por permitirnos acompañarte en este proceso. Si tienes alguna duda, escríbenos a <a href="mailto:' + EMAIL_RESP + '">' + EMAIL_RESP + '</a>.</div>';
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
        '        document.querySelector(".card-body").innerHTML = \'<div style="text-align:center;padding:30px 0;"><div style="font-size:48px;margin-bottom:16px;">&#x2705;</div><h2 style="color:#0d5a96;margin-bottom:10px;">\\u00A1Muchas gracias!</h2><p style="color:#718096;font-size:14px;line-height:1.7;">Nos alegra saber que tu solicitud <strong>' + id + '</strong> fue atendida de manera satisfactoria.<br><br><span style="font-size:20px;color:#f6a609;">\' + starsHtml + \'</span><br><span style="font-size:13px;color:#856404;font-weight:600;">\' + ratingLabels[selectedRating] + \' (\' + selectedRating + \'/5)</span><br><br>Tu calificaci\\u00F3n ha sido registrada. En el Colegio Goyavier Campestre trabajamos cada d\\u00EDa para brindarte la mejor atenci\\u00F3n.<br><br><a href="mailto:' + EMAIL_RESP + '">' + EMAIL_RESP + '</a></p></div>\';' +
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
        '        document.querySelector(".card-body").innerHTML = \'<div style="text-align:center;padding:30px 0;"><div style="font-size:48px;margin-bottom:16px;">&#x1F4E8;</div><h2 style="color:#0d5a96;margin-bottom:10px;">¡Recibimos tu observación!</h2><p style="color:#718096;font-size:14px;line-height:1.7;">Gracias por tomarte el tiempo de compartir tu opinión sobre la solicitud <strong>' + id + '</strong>.<br><br>Nuestro equipo la revisará con atención y te contactaremos a la brevedad. Estamos atentos a brindarte el mejor acompañamiento posible.<br><br>Gracias por permitirnos acompañarte en este proceso.<br><br><a href="mailto:' + EMAIL_RESP + '">' + EMAIL_RESP + '</a></p></div>\';' +
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
        'El padre de familia no quedó satisfecho con la respuesta recibida y ha registrado una observación o inconformidad sobre la solicitud ' + id + '.\n\n' +
        'Observación del solicitante:\n' + obs + '\n\n' +
        'El caso ha pasado al estado "Apelado". Por favor ingrese al sistema PQRS para revisar la observación,\n' +
        'comunicarla al área responsable y hacer el seguimiento correspondiente.\n\n' +
        'Recuerde que el solicitante está esperando una nueva respuesta que atienda su inconformidad.\n\n' +
        'Con atención,\nSistema PQRS · Colegio Goyavier Campestre';
      GmailApp.sendEmail(EMAIL_RESP, asunto, cuerpo, {name: 'PQRS Colegio Goyavier'});
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
        'El padre de familia confirmó que su solicitud fue atendida satisfactoriamente y solicitó el cierre del caso.' + calTexto,
        'Cerrado', new Date().toISOString(), 'cierre_solicitante', nombreCierre || 'Solicitante', Utilities.getUuid()]);
    } catch(segErrCierre) { Logger.log('Seg cierre err: ' + segErrCierre.message); }
    try {
      const asunto = '[PQRS Goyavier] Caso cerrado por el solicitante · ' + id;
      const calInfo = cal >= 1 ? '\nCalificación otorgada: ' + cal + '/5 estrellas.' : '';
      const cuerpo = 'El padre de familia confirmó que su solicitud ' + id + ' fue atendida de manera satisfactoria y procedió a cerrar su caso.' + calInfo + '\n\nNo se requiere ninguna acción adicional. ¡Buena gestión!';
      GmailApp.sendEmail(EMAIL_RESP, asunto, cuerpo, {name: 'PQRS Colegio Goyavier'});
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
          'Importante: Esta respuesta aún no ha sido enviada al solicitante. Solo Secretaría o Rectoría pueden hacerlo desde la aplicación.\n\n' +
          'Con atención,\nSistema PQRS · Colegio Goyavier Campestre'
        : 'El equipo de ' + area + ' acaba de registrar su respuesta a la solicitud ' + id + '.\n\n' +
          'Respuesta del área:\n' + obs + '\n\n' +
          'Por favor ingrese al sistema PQRS para revisar esta respuesta y, si es adecuada, enviarla oficialmente al solicitante.\n\n' +
          'Importante: Esta respuesta aún no ha sido enviada al solicitante. Solo Secretaría o Rectoría pueden hacerlo desde la aplicación.\n\n' +
          'Con atención,\nSistema PQRS · Colegio Goyavier Campestre';
      GmailApp.sendEmail(EMAIL_RESP, asuntoSec, cuerpoSec, {name: 'PQRS Colegio Goyavier'});
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
        clave:  claveCol  >= 0 ? String(data[i][claveCol]  || '') : ''
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
  cache.remove(rlKey);
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('pqrs_token_' + token, JSON.stringify({
    usuario: found.email, email: found.email, nombre: found.nombre, role: 'Staff',
    createdAt: new Date().toISOString()
  }), 21600);
  return jsonOut({ok: true, token: token, usuario: found.email, email: found.email, nombre: found.nombre, role: 'Staff'});
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('pqrs_token_' + String(token));
  return jsonOut({ok: true});
}

// Autenticación con Google — mismo patrón que Zaiko y Paz y Salvo.
// El cliente envía el access_token obtenido via oauth2.initTokenClient.
// GAS lo valida con la userinfo API de Google, luego comprueba el email
// contra la hoja UsuariosPQRS (creada por inicializarSistema).
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
    if (emailCol < 0) return jsonOut({ok: false, error: 'Hoja UsuariosPQRS mal configurada (falta columna Email).'});

    var found = null;
    for (var i = 1; i < usuData.length; i++) {
      if (String(usuData[i][emailCol] || '').toLowerCase().trim() === email) {
        found = {
          email:  email,
          nombre: nombreCol >= 0 ? String(usuData[i][nombreCol] || email).trim() : email,
          estado: estadoCol >= 0 ? String(usuData[i][estadoCol] || 'ACTIVO').trim().toUpperCase() : 'ACTIVO'
        };
        break;
      }
    }
    if (!found)                    return jsonOut({ok: false, error: 'Correo no autorizado: ' + email});
    if (found.estado !== 'ACTIVO') return jsonOut({ok: false, error: 'Usuario inactivo. Contacte al administrador.'});

    // 3. Emitir token de sesión (6 h)
    var sessionToken = Utilities.getUuid();
    CacheService.getScriptCache().put('pqrs_token_' + sessionToken, JSON.stringify({
      usuario: found.email,
      email:   found.email,
      nombre:  found.nombre,
      role:    'Staff',
      createdAt: new Date().toISOString()
    }), 21600);
    return jsonOut({ok: true, token: sessionToken, usuario: found.email, email: found.email, nombre: found.nombre, role: 'Staff'});
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

    const get = function(field) { var c = col(field); return c >= 0 ? String(pqrsRow[c] || '').trim() : ''; };
    const dep          = get('Dependencia');
    const nombreSol    = get('Nombre')              || 'el solicitante';
    const correoSol    = get('Correo')              || '';
    const estudiante   = get('Estudiante')          || '-';
    const grado        = get('Grado')               || '-';
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

    const remitente  = auth && auth.nombre ? auth.nombre : 'Secretaría';
    const asunto     = '[PQRS Goyavier] Observación del solicitante — Solicitud ' + id + ' — ' + dep;
    const cuerpo     =
      'Hola, equipo de ' + dep + '.\n\n' +
      'Les informamos que el padre de familia ha registrado una observación o inconformidad\n' +
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
      '  Estudiante       : ' + estudiante + '\n' +
      '  Grado            : ' + grado + '\n\n' +
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
      'Importante: Su respuesta llegará primero al sistema. Secretaría o Rectoría la\n' +
      'revisarán antes de comunicarla oficialmente al solicitante.\n\n' +
      'Con atención y agradecimiento,\n' + remitente + '\nColegio Goyavier Campestre · Sistema PQRS';

    const opts = {name: 'PQRS Colegio Goyavier', replyTo: EMAIL_RESP};
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

function getHeaders() {
  return ['ID','Fecha','Dependencia','Nombre',
    'Telefono','Correo','Estudiante','Grado','TipoSolicitud','MedioRecepcion',
    'RequiereRespuesta','Descripcion','Estado','EmailPendiente','CreadoEn','OrigenForms',
    'ObservacionSolicitante','FechaObservacion','FormsKey','Calificacion'];
}

function ensureHeaders(sheet) {
  const headers = getHeaders();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  const maxCols = Math.max(sheet.getLastColumn(), headers.length);
  sheet.getRange(1, 1, 1, maxCols).clearContent();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
}

function generarId(sheet) {
  const existingIds = new Set();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat()
      .forEach(id => { if (id) existingIds.add(String(id).trim()); });
  }
  let maxNum = 0;
  existingIds.forEach(id => {
    const n = parseInt(String(id).replace('PQRS2260', '')) || 0;
    if (n > maxNum) maxNum = n;
  });
  let candidate;
  do {
    maxNum++;
    candidate = 'PQRS2260' + String(maxNum).padStart(4, '0');
  } while (existingIds.has(candidate));
  return candidate;
}

// ============================================================
// Ejecutar UNA SOLA VEZ desde el editor de Apps Script:
//   Funciones > inicializarSistema > Ejecutar
// Crea y configura todas las hojas necesarias con valores por defecto.
// ============================================================
// ============================================================
// Ejecutar UNA SOLA VEZ desde el editor de Apps Script:
//   Funciones → inicializarSistema → Ejecutar
// Crea y configura todas las hojas necesarias.
// ============================================================
function inicializarSistema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Hoja PQRS
  let pqrsSheet = ss.getSheetByName(SHEET_NAME);
  if (!pqrsSheet) pqrsSheet = ss.insertSheet(SHEET_NAME);
  ensureHeaders(pqrsSheet);

  // Hoja Seguimientos
  let segSheet = ss.getSheetByName(SEG_SHEET);
  if (!segSheet) {
    segSheet = ss.insertSheet(SEG_SHEET);
    const segHeaders = ['PQRS_ID','Fecha','Respuesta','Estado','RegistradoEn','Tipo','Autor','SegKey'];
    segSheet.appendRow(segHeaders);
    segSheet.getRange(1, 1, 1, segHeaders.length).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
  }

  // Hoja Configuracion con valores por defecto
  let cfgSheet = ss.getSheetByName(CFG_SHEET);
  if (!cfgSheet) {
    cfgSheet = ss.insertSheet(CFG_SHEET);
    cfgSheet.appendRow(['Clave', 'Valor']);
    cfgSheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
  }
  if (cfgSheet.getLastRow() > 1) cfgSheet.getRange(2, 1, cfgSheet.getLastRow() - 1, 2).clearContent();
  const configDefecto = {
    diasRespuesta: 15,
    alertaDias: 2,
    emailAreas: {},
    dependencias: [
      'Coord. Preescolar','Coord. Academica','Bachillerato','Mantenimiento',
      'Servicio de restaurante','Coord. Primaria','Coord. Convivencia',
      'Secretaria','Servicios Varios','Biblioteca','Sistemas','Enfermeria'
    ]
  };
  Object.entries(configDefecto).forEach(([k, v], i) => {
    cfgSheet.getRange(i + 2, 1, 1, 2).setValues([[k, JSON.stringify(v)]]);
  });

  // Hoja UsuariosPQRS — usuarios autorizados para acceder al sistema via Google
  // Agrega los 3 usuarios por defecto si no existen aún.
  let usuSheet = ss.getSheetByName(USUARIOS_SHEET);
  if (!usuSheet) {
    usuSheet = ss.insertSheet(USUARIOS_SHEET);
    const usuHeaders = ['Email', 'Nombre', 'Estado', 'Clave'];
    usuSheet.appendRow(usuHeaders);
    usuSheet.getRange(1, 1, 1, usuHeaders.length).setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
  }
  // Agregar columna Clave si la hoja ya existía sin ella
  const hdrs = usuSheet.getRange(1, 1, 1, usuSheet.getLastColumn()).getValues()[0];
  if (hdrs.indexOf('Clave') < 0) {
    usuSheet.getRange(1, usuSheet.getLastColumn() + 1).setValue('Clave').setFontWeight('bold').setBackground('#1575bc').setFontColor('#ffffff');
  }
  // Los usuarios y claves se gestionan directamente en la hoja UsuariosPQRS — no se insertan desde el código.

  Logger.log('✓ Sistema PQRS inicializado correctamente. Revise la hoja UsuariosPQRS para gestionar usuarios y claves.');
}