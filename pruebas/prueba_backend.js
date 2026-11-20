// Banco de pruebas del backend (Apps Script) con servicios de Google simulados.
// Uso: node pruebas/prueba_backend.js   (o con la ruta a otro .gs como argumento)
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');

const path = require('path');
const gsPath = process.argv[2] || path.join(__dirname, '..', 'CODE-APPS-SCRIPT-FINAL.gs');
const code = fs.readFileSync(gsPath, 'utf8');

// ───────────── Simulación de Google Sheets (con sus conversiones automáticas) ─────────────
let RealmDate = Date;      // la clase Date del «mundo» del script (se fija en cada entorno)
function convert(v) {
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new RealmDate(y, m - 1, d); }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)) return new RealmDate(v);
    if (v === 'TRUE') return true;
    if (v === 'FALSE') return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  }
  return v;
}
class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh._get(this.r + i, this.c + j)); o.push(row); } return o; }
  setValues(v) { for (let i = 0; i < v.length; i++) for (let j = 0; j < v[i].length; j++) this.sh._set(this.r + i, this.c + j, v[i][j]); return this; }
  setValue(v) { this.sh._set(this.r, this.c, v); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh._set(this.r + i, this.c + j, ''); return this; }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
  getRow() { return this.r; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.writes = 0; }
  _get(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; }
  _set(r, c, v) { this.writes++; while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = convert(v); }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some(x => x !== '' && x !== undefined)) return i; return 0; }
  getLastColumn() { let m = 0; this.rows.forEach(r => { for (let j = r.length; j > 0; j--) if (r[j - 1] !== '' && r[j - 1] !== undefined) { m = Math.max(m, j); break; } }); return m; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  appendRow(a) { const r = this.getLastRow() + 1; a.forEach((v, j) => this._set(r, j + 1, v)); }
  deleteRow(n) { this.rows.splice(n - 1, 1); }
  col(h) { return this.rows[0].indexOf(h); }
  cell(r, h) { return this.rows[r][this.col(h)]; }          // r = índice de fila (0 = encabezado)
  rowById(id) { const i = this.col('ID'); return this.rows.slice(1).find(x => String(x[i]).trim() === id); }
}

function crearEntorno(fuente) {
  const sheets = {};
  const outbox = [], logs = [];
  let uid = 0;
  const lock = { held: false };
  const props = {};
  const cache = {};
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: n => sheets[n] || null,
      insertSheet: n => (sheets[n] = new Sheet(n)),
    }) },
    LockService: { getScriptLock: () => ({
      tryLock() { if (lock.held) { lock.nested = true; return false; } lock.held = true; return true; },
      waitLock() { if (lock.held) throw new Error('bloqueo anidado'); lock.held = true; },
      releaseLock() { lock.held = false; },
    }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
    Utilities: {
      getUuid: () => 'uuid-' + (++uid),
      formatDate: (d, tz, f) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      base64Encode: s => Buffer.from(s).toString('base64'), Charset: { UTF_8: 'UTF-8' },
    },
    Session: { getScriptTimeZone: () => 'America/Bogota' },
    GmailApp: { sendEmail: (to, subject, body, opts) => outbox.push({ to, subject, body, opts: opts || {} }) },
    ContentService: { createTextOutput: t => ({ _t: t, setMimeType() { return this; } }), MimeType: { JSON: 'json', JAVASCRIPT: 'js' } },
    HtmlService: { createHtmlOutput: h => ({ html: h, setTitle() { return this; }, setXFrameOptionsMode() { return this; } }),
                   createHtmlOutputFromFile: f => ({ file: f, setTitle() { return this; }, setXFrameOptionsMode() { return this; } }),
                   XFrameOptionsMode: { SAMEORIGIN: 1 } },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/X/exec' }) },
    Logger: { log: m => logs.push(String(m)) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ email: ctx.__googleEmail }) }) },
  });
  vm.runInContext(fuente || code, ctx, { filename: 'codigo.gs' });
  RealmDate = vm.runInContext('Date', ctx);
  const env = {
    sheets, outbox, logs, lock, props, cache, ctx,
    run(expr, vars = {}) { Object.assign(ctx, { __v: vars }); return vm.runInContext(expr, ctx); },
    json(out) { return JSON.parse(out._t); },
    call(fn, ...args) { ctx.__args = args; return env.run(`${fn}(...__args)`); },
    callJson(fn, ...args) { return env.json(env.call(fn, ...args)); },
    get(params) { return env.json(env.run('doGet(__v)', { parameter: params })); },
    post(payload) { return env.json(env.run('doPost(__v)', { postData: { contents: JSON.stringify(payload) } })); },
    sheet(n) { return sheets[n]; },
    login(usuario, clave) { return env.callJson('login_', usuario, clave); },
  };
  return env;
}

// ───────────── Datos de partida: la estructura REAL de la base "PQRS Goyavier" ─────────────
const HDR_PQRS = ['ID','Fecha','Dependencia','Nombre','Telefono','Correo','Estudiante','Grado','TipoSolicitud','MedioRecepcion',
  'RequiereRespuesta','Descripcion','Estado','EmailPendiente','CreadoEn','OrigenForms','ObservacionSolicitante','FechaObservacion','FormsKey','Calificacion','TokenRespuesta'];
const HDR_FORMS = ['Marca temporal','Nombre completo','Correo electrónico donde recibirás respuesta y seguimiento de tu PQRS.','Teléfono','Nombre del estudiante','Tipo de solicitud','Requiere respuesta','Descripción de la solicitud','Grado','Revisado','FormsID'];

function sembrar(env) {
  const P = env.sheets['PQRS'] = new Sheet('PQRS');
  P.appendRow(HDR_PQRS);
  const base = (o) => HDR_PQRS.map(h => ({
    ID: o.id, Fecha: '2026-10-01', Dependencia: o.dep || '', Nombre: 'Persona ' + o.id.slice(-2), Telefono: '3001234567', Correo: 'p' + o.id.slice(-2) + '@mail.com',
    Estudiante: o.est || '', Grado: o.grado || '', TipoSolicitud: 'Queja', MedioRecepcion: 'Forms', RequiereRespuesta: 'Si', Descripcion: 'Texto ' + o.id,
    Estado: o.estado, EmailPendiente: 'FALSE', CreadoEn: '2026-10-01T15:00:00.000Z', OrigenForms: 'TRUE', ObservacionSolicitante: '', FechaObservacion: '',
    FormsKey: 'fk-' + o.id, Calificacion: o.cal || '', TokenRespuesta: 'tk-' + o.id,
  })[h] ?? '');
  const filas = [
    { id: 'PQRS22600001', estado: 'Proceso', est: 'Est Uno', grado: 'Sexto A' },
    { id: 'PQRS22600002', estado: 'Borrador', est: 'Est Dos', grado: 'Kinder A' },
    { id: 'PQRS22600003', estado: 'Proceso' },
    { id: 'PQRS22600004', estado: 'Abierto' },
    { id: 'PQRS22600005', estado: 'Cerrado' },
    { id: 'PQRS22600006', estado: 'Cerrado', grado: 'Colaborador' },          // legado: «Colaborador» venía como grado
    { id: 'PQRS22600007', estado: 'Cerrado', est: 'Est Siete', grado: '5°', cal: 5 },
    { id: 'PQRS22600008', estado: 'Cerrado', est: 'Est Ocho', grado: 'NA' },
  ];
  filas.forEach(o => P.appendRow(base(o)));
  const tipos = { 1: 'Padre de familia', 2: 'Estudiante', 3: 'Colaborador', 4: 'Proveedor o contratista', 5: 'Visitante' };
  // En la base real todavía no existe TipoSolicitante: se agrega con actualizarEstructura() y solo en filas nuevas se llena.
  env._tipos = tipos;

  const S = env.sheets['Seguimientos'] = new Sheet('Seguimientos');
  S.appendRow(['PQRS_ID','Fecha','Respuesta','Estado','RegistradoEn','Tipo','Autor','SegKey']);
  S.appendRow(['PQRS22600001', '2026-10-02', 'Se asignó', 'Proceso', '2026-10-02T14:00:00.000Z', 'despacho', 'Secretaría Académica', '2026-10-02T14:00:00.000Z']);
  S.appendRow(['PQRS22600001', '2026-10-03', 'Respuesta del área', 'Proceso', '2026-10-03T14:00:00.000Z', 'area', 'Coord. Preescolar', 'PQRS22600001_n1']);
  S.appendRow(['PQRS22600003', '2026-10-03', 'Respuesta del área TH', 'Proceso', '2026-10-03T15:00:00.000Z', 'area', 'Mantenimiento', 'PQRS22600003_n1']);

  const C = env.sheets['Configuracion'] = new Sheet('Configuracion');
  C.appendRow(['Clave', 'Valor']);
  C.appendRow(['diasRespuesta', '15']); C.appendRow(['alertaDias', '2']);
  C.appendRow(['emailAreas', JSON.stringify({ 'Coord. Preescolar': 'coord@colegio.edu.co' })]);
  C.appendRow(['dependencias', JSON.stringify(['Coord. Preescolar', 'Secretaria'])]);

  const U = env.sheets['UsuariosPQRS'] = new Sheet('UsuariosPQRS');
  U.appendRow(['Email', 'Nombre', 'Estado', 'Clave']);
  U.appendRow(['soporte@colegio.edu.co', 'Soporte PQRS', 'ACTIVO', 'k-soporte']);
  U.appendRow(['secretaria@colegio.edu.co', 'Secretaría Académica', 'ACTIVO', 'k-sec']);
  U.appendRow(['rectoria@colegio.edu.co', 'Rectoría', 'ACTIVO', 'k-rect']);

  const F = env.sheets['Respuestas de formulario 1'] = new Sheet('Respuestas de formulario 1');
  F.appendRow(HDR_FORMS);
}

// ───────────── Utilidades de prueba ─────────────
let n = 0;
function ok(msg) { n++; console.log('  ✓ ' + msg); }
function ids(arr) { return arr.map(x => x.ID.slice(-2)).sort().join(','); }
const snapshot = (sh, id) => JSON.stringify(sh.rowById(id));

(function main() {
  // ============ 0. Actualización de la estructura sobre la base real ============
  console.log('\n[0] actualizarEstructura() sobre la estructura real');
  const env = crearEntorno(); sembrar(env);
  const P = env.sheet('PQRS');
  const colToken0 = P.col('TokenRespuesta'), colCal0 = P.col('Calificacion');
  env.call('actualizarEstructura');
  assert.equal(P.col('TokenRespuesta'), colToken0, 'TokenRespuesta no debe moverse');
  assert.equal(P.col('Calificacion'), colCal0);
  assert.equal(P.col('TipoSolicitante'), 21, 'la columna nueva va al final (col 22), sin pisar TokenRespuesta (col 21)');
  assert.equal(P.cell(1, 'TokenRespuesta'), 'tk-PQRS22600001', 'los tokens siguen donde estaban');
  ok('columna TipoSolicitante agregada al final; TokenRespuesta (col 21) y Calificacion (col 20) intactas');
  const U = env.sheet('UsuariosPQRS');
  assert.ok(U.col('Perfil') >= 0); ok('UsuariosPQRS recibió la columna Perfil');
  assert.ok(env.logs.join('\n').includes('FALTA asignar'), 'avisa de usuarios sin perfil');
  ok('avisa qué usuarios aún no tienen perfil (y que no podrán entrar)');
  const antes = JSON.stringify(P.rows); env.call('actualizarEstructura');
  assert.equal(JSON.stringify(P.rows), antes); ok('es idempotente (repetirla no cambia nada)');
  const cfg = env.callJson('getConfig');
  assert.deepEqual(Object.keys(cfg).sort(), ['alertaDias','copiarRectoria','dependencias','diasRespuesta','emailAreas','emailPerfiles'].sort());
  assert.equal(cfg.dependencias.length, 2); ok('Configuracion: se agregaron emailPerfiles/copiarRectoria sin borrar lo existente');

  // Datos tras la migración: tipo en las filas nuevas (las antiguas quedan vacías a propósito)
  Object.entries(env._tipos).forEach(([k, v]) => { P.rows[Number(k)][P.col('TipoSolicitante')] = v; });

  // Perfiles de usuario + correos por perfil
  const iPerf = U.col('Perfil');
  U.rows[1][iPerf] = 'Rectoria';                // Soporte PQRS
  U.rows[2][iPerf] = 'Secretaria';
  U.rows[3][iPerf] = 'rectoría';                // se tolera escritura distinta
  U.appendRow(['th@colegio.edu.co', 'Talento Humano', 'ACTIVO', 'k-th', 'Talento Humano']);
  U.appendRow(['sinperfil@colegio.edu.co', 'Sin perfil', 'ACTIVO', 'k-x', '']);
  const C = env.sheet('Configuracion');
  const filaEP = C.rows.findIndex(r => r[0] === 'emailPerfiles');
  C.rows[filaEP][1] = JSON.stringify({ secretaria: 'sec@colegio.edu.co', talentoHumano: 'th@colegio.edu.co', rectoria: 'rect@colegio.edu.co' });

  // ============ 1. Login con perfil ============
  console.log('\n[1] Login y sesión');
  const lSec = env.login('secretaria', 'k-sec'); assert.equal(lSec.ok, true); assert.equal(lSec.perfil, 'Secretaria');
  const lTh = env.login('th@colegio.edu.co', 'k-th'); assert.equal(lTh.perfil, 'Talento Humano');
  const lRect = env.login('rectoria', 'k-rect'); assert.equal(lRect.perfil, 'Rectoria');
  ok('cada usuario recibe su perfil (Secretaria / Talento Humano / Rectoria)');
  const lNo = env.login('sinperfil', 'k-x'); assert.equal(lNo.ok, false); assert.match(lNo.error, /perfil/i);
  ok('un usuario sin perfil NO puede entrar (falla cerrado)');
  env.cache['pqrs_token_viejo'] = JSON.stringify({ usuario: 'a', email: 'a', nombre: 'a', role: 'Staff' });
  const vieja = env.get({ action: 'getData', token: 'viejo' });
  assert.equal(vieja.ok, false); ok('una sesión antigua (rol «Staff», anterior al cambio) se rechaza y obliga a iniciar sesión de nuevo');
  const tSec = lSec.token, tTh = lTh.token, tRect = lRect.token;

  // ============ 2. Lectura filtrada ============
  console.log('\n[2] getData: cada perfil ve solo su bandeja');
  const dSec = env.get({ action: 'getData', token: tSec });
  const dTh = env.get({ action: 'getData', token: tTh });
  const dRect = env.get({ action: 'getData', token: tRect });
  assert.equal(ids(dSec), '01,02,07,08'); ok('Secretaría ve: padre de familia, estudiante y los antiguos con grado (01,02,07,08)');
  assert.equal(ids(dTh), '03,04,05,06'); ok('Talento Humano ve: colaborador, proveedor/contratista, visitante y el antiguo «Colaborador» (03,04,05,06)');
  assert.equal(ids(dRect), '01,02,03,04,05,06,07,08'); ok('Rectoría ve todo (8 de 8)');
  assert.ok(dTh.every(r => !('TokenRespuesta' in r))); ok('el token de respuesta ya no se envía al navegador');
  const r6 = dTh.find(r => r.ID.endsWith('06'));
  assert.equal(r6.TipoSolicitante, 'Colaborador'); assert.equal(r6.Grado, ''); assert.equal(r6.Bandeja, 'talento');
  ok('el PQRS antiguo con grado «Colaborador» se muestra como Colaborador, sin grado');
  assert.ok(dSec.every(r => r.Bandeja === 'secretaria')); assert.equal(dSec.find(r => r.ID.endsWith('01')).seguimientos.length, 2);
  ok('cada solicitud trae su bandeja y sus seguimientos');

  // ============ 3. Guardado: aislamiento entre perfiles ============
  console.log('\n[3] syncData: no se pisan datos entre perfiles');
  const hidden = ['03', '04', '05', '06'].map(x => snapshot(P, 'PQRS226000' + x));
  const calAntes = P.cell(7, 'Calificacion'); assert.equal(calAntes, 5);
  // El cliente de Secretaría devuelve lo que recibió (sin Calificacion ni TokenRespuesta) y modifica la dependencia de la 01
  const aEnviar = dSec.map(r => ({
    id: r.ID, fecha: r.Fecha, dependencia: r.Dependencia, nombre: r.Nombre, telefono: r.Telefono, correo: r.Correo, estudiante: r.Estudiante, grado: r.Grado,
    tipoSolicitante: r.TipoSolicitante, tipoSolicitud: r.TipoSolicitud, medioRecepcion: r.MedioRecepcion, requiereRespuesta: r.RequiereRespuesta,
    descripcion: r.Descripcion, estado: r.Estado, emailPendiente: r.EmailPendiente === 'TRUE', createdAt: r.CreadoEn, origenForms: r.OrigenForms === 'TRUE',
    observacionSolicitante: r.ObservacionSolicitante, fechaObservacion: r.FechaObservacion, formsKey: r.FormsKey, seguimientos: r.seguimientos,
  }));
  aEnviar.find(s => s.id.endsWith('01')).dependencia = 'Coord. Preescolar';
  const idNueva = env.get({ action: 'nextId', token: tSec }).id;
  assert.equal(idNueva, 'PQRS22600009'); ok('nextId reserva el consecutivo global (aunque Secretaría no vea las otras solicitudes)');
  aEnviar.push({ id: idNueva, fecha: '2026-11-19', dependencia: 'Secretaria', nombre: 'Nueva', telefono: '300', correo: 'n@x.com', estudiante: 'E', grado: '3A',
    tipoSolicitante: 'Padre de familia', tipoSolicitud: 'Peticion', medioRecepcion: 'Verbal', requiereRespuesta: 'Si', descripcion: 'd', estado: 'Abierto',
    emailPendiente: false, createdAt: '2026-11-19T10:00:00.000Z', origenForms: false, seguimientos: [] });
  aEnviar.push({ id: 'PQRS22600003', nombre: 'INTENTO DE PISAR', tipoSolicitante: 'Colaborador', estado: 'Cerrado', seguimientos: [] });         // fila de otra bandeja
  aEnviar.push({ id: 'PQRS22600010', nombre: 'Nueva de otra bandeja', tipoSolicitante: 'Visitante', estado: 'Abierto', seguimientos: [] });       // creada en bandeja ajena
  const res = env.post({ token: tSec, action: 'sync', data: aEnviar, eliminados: ['PQRS22600002', 'PQRS22600003', 'PQRS22600001'] });
  assert.equal(res.ok, true); assert.equal(res.rechazadas, 2); assert.equal(res.eliminadas, 1);
  ok('rechaza lo que no es de su bandeja (2 intentos) y elimina solo 1 borrador propio');
  ['03', '04', '05', '06'].forEach((x, i) => assert.equal(snapshot(P, 'PQRS226000' + x), hidden[i], 'fila ' + x + ' debe quedar idéntica'));
  ok('las 4 solicitudes de Talento Humano quedaron exactamente iguales (incluido el intento de pisar la 03)');
  assert.equal(P.rowById('PQRS22600002'), undefined); assert.ok(P.rowById('PQRS22600001')); ok('«Descartar» borró la 02 (borrador propio); la 01 (en proceso) y la 03 (ajena) NO se borraron aunque se pidió');
  assert.equal(P.cell(P.rows.indexOf(P.rowById('PQRS22600001')), 'Dependencia'), 'Coord. Preescolar'); ok('el cambio legítimo (dependencia de la 01) sí se guardó');
  assert.equal(P.rowById('PQRS22600007')[P.col('Calificacion')], 5); ok('la calificación de estrellas (5) YA NO se borra al guardar');
  assert.equal(P.rowById('PQRS22600001')[P.col('TokenRespuesta')], 'tk-PQRS22600001'); ok('los tokens de respuesta se conservan');
  const nuevaFila = P.rowById(idNueva); assert.ok(nuevaFila); assert.equal(nuevaFila[P.col('TipoSolicitante')], 'Padre de familia'); ok('la solicitud manual nueva quedó con su tipo de solicitante');
  assert.equal(P.rowById('PQRS22600010'), undefined); ok('no se puede crear una solicitud en la bandeja ajena');

  // ============ 4. Seguimientos ============
  console.log('\n[4] Seguimientos: nunca se pierden ni se duplican');
  const S = env.sheet('Seguimientos');
  const cuenta = id => S.rows.slice(1).filter(r => r[0] === id).length;
  assert.equal(cuenta('PQRS22600003'), 1); assert.equal(cuenta('PQRS22600001'), 2); ok('las respuestas de área de ambas bandejas siguen ahí');
  const d2 = env.get({ action: 'getData', token: tSec });
  const s1 = d2.find(r => r.ID.endsWith('01'));
  s1.seguimientos[1].tipo = 'aprobada';                                    // la secretaria «aprueba» la respuesta del área
  s1.seguimientos.push({ fecha: '2026-11-19', respuesta: 'Seguimiento nuevo', estado: 'Proceso', registradoEn: '2026-11-19T12:00:00.000Z', tipo: 'secretaria', autor: 'Sec', segKey: '2026-11-19T12:00:00.000Z' });
  const mapear = r => ({ id: r.ID, fecha: r.Fecha, dependencia: r.Dependencia, nombre: r.Nombre, telefono: r.Telefono, correo: r.Correo, estudiante: r.Estudiante, grado: r.Grado,
    tipoSolicitante: r.TipoSolicitante, tipoSolicitud: r.TipoSolicitud, medioRecepcion: r.MedioRecepcion, requiereRespuesta: r.RequiereRespuesta, descripcion: r.Descripcion,
    estado: r.Estado, emailPendiente: false, createdAt: r.CreadoEn, origenForms: r.OrigenForms === 'TRUE', formsKey: r.FormsKey, seguimientos: r.seguimientos });
  const a = env.post({ token: tSec, action: 'sync', data: d2.map(mapear) }); assert.equal(a.segNuevos, 1);
  if (process.env.DEBUG) console.log(JSON.stringify(S.rows.slice(1).map(r => [r[0], r[5], String(r[7]), r[4] instanceof Date ? 'DATE' : typeof r[4]])));
  const b = env.post({ token: tSec, action: 'sync', data: d2.map(mapear) }); if (process.env.DEBUG) console.log('b=', JSON.stringify(b), JSON.stringify(S.rows.slice(1).map(r => [r[0], r[5], String(r[7])]))); assert.equal(b.segNuevos, 0);
  assert.equal(cuenta('PQRS22600001'), 3); ok('seguimiento nuevo agregado una sola vez aunque se guarde dos veces');
  assert.equal(S.rows.slice(1).find(r => r[7] === 'PQRS22600001_n1')[5], 'aprobada'); ok('el cambio de tipo area→aprobada se aplicó sobre la misma fila');
  // el área responde MIENTRAS la secretaria tiene datos viejos: esa respuesta no puede perderse
  S.appendRow(['PQRS22600001', '2026-11-19', 'Respuesta tardía del área', 'Proceso', '2026-11-19T13:00:00.000Z', 'area', 'Coord.', 'PQRS22600001_n2']);
  env.post({ token: tSec, action: 'sync', data: d2.map(mapear) });
  assert.equal(cuenta('PQRS22600001'), 4); ok('una respuesta de área que llega entre dos guardados no se borra');

  // ============ 5. Rectoría ============
  console.log('\n[5] Rectoría');
  const dR = env.get({ action: 'getData', token: tRect });
  assert.equal(dR.length, 8); // 01,03..08 + nueva(09); la 02 se descartó
  const w0 = P.writes;
  const r5 = env.post({ token: tRect, action: 'sync', data: dR.map(mapear) });
  assert.equal(r5.rechazadas, 0); assert.equal(r5.actualizadas, 1);
  const f6 = P.rowById('PQRS22600006'); assert.equal(f6[P.col('TipoSolicitante')], 'Colaborador'); assert.equal(f6[P.col('Grado')], '');
  ok('Rectoría guarda todo sin rechazos; el único cambio es la corrección automática del PQRS antiguo con grado «Colaborador» (queda con tipo Colaborador y sin grado)');
  const w1 = P.writes; const r5b = env.post({ token: tRect, action: 'sync', data: env.get({ action: 'getData', token: tRect }).map(mapear) });
  assert.equal(r5b.actualizadas, 0); assert.equal(P.writes, w1); ok('un segundo guardado idéntico no reescribe ninguna fila (0 celdas escritas)');
  const calSigue = P.rowById('PQRS22600007')[P.col('Calificacion')]; assert.equal(calSigue, 5);
  const sRe = dR.find(r => r.ID.endsWith('03')); sRe.TipoSolicitante = 'Estudiante'; sRe.Estudiante = 'Hijo'; sRe.Grado = '7A';   // Rectoría reasigna 03 a Secretaría
  env.post({ token: tRect, action: 'sync', data: dR.map(mapear) });
  assert.equal(ids(env.get({ action: 'getData', token: tSec })).includes('03'), true);
  assert.equal(ids(env.get({ action: 'getData', token: tTh })).includes('03'), false); ok('Rectoría puede reasignar una solicitud de bandeja y cada perfil la ve en su sitio');

  // ============ 6. Enlaces públicos (solicitante / área) ============
  console.log('\n[6] Enlaces públicos con candado y correo a la bandeja correcta');
  const tokRow = P.rowById('PQRS22600004'); const bAntes = env.outbox.length;
  const obs = env.get({ action: 'guardarRespuestaJson', id: 'PQRS22600004', obs: 'No quedé conforme', tkn: 'tk-PQRS22600004' });
  assert.equal(obs.ok, true, JSON.stringify(obs)); assert.equal(env.lock.nested, undefined); ok('la observación del solicitante funciona sin bloqueos anidados');
  assert.equal(P.rowById('PQRS22600004')[P.col('Estado')], 'Apelado'); assert.equal(P.rowById('PQRS22600004')[P.col('TokenRespuesta')], '');
  const m = env.outbox[env.outbox.length - 1];
  assert.equal(m.to, 'th@colegio.edu.co'); assert.ok(m.body.includes('El solicitante no quedó satisfecho')); assert.ok(!/padre de familia/i.test(m.body));
  ok('la observación de un proveedor/contratista avisa solo a Talento Humano (ni a Secretaría ni a Rectoría)');
  const cer = env.get({ action: 'cerrarPqrsJson', id: 'PQRS22600001', calificacion: '4', tkn: 'tk-PQRS22600001' });
  assert.equal(cer.ok, true); assert.equal(P.rowById('PQRS22600001')[P.col('Calificacion')], 4);
  assert.equal(env.outbox[env.outbox.length - 1].to, 'sec@colegio.edu.co'); ok('cierre con calificación (4): se guarda y avisa solo a Secretaría');
  const ar = env.get({ action: 'guardarRespuestaAreaJson', id: 'PQRS22600003', area: 'Mantenimiento', obs: 'Resuelto', nonce: 'zz' });
  assert.equal(ar.ok, true); assert.equal(env.outbox[env.outbox.length - 1].to, 'sec@colegio.edu.co');
  ok('respuesta de un área: el aviso va a la bandeja actual de la solicitud (la 03 fue reasignada a Secretaría en el paso anterior)');
  env.lock.held = true;                                                 // alguien más está guardando
  const ocupado = env.get({ action: 'guardarRespuestaJson', id: 'PQRS22600005', obs: 'x', tkn: 'tk-PQRS22600005' });
  assert.equal(ocupado.ok, false); assert.match(ocupado.error, /ocupado/i); env.lock.held = false; env.lock.nested = undefined;
  ok('si el sistema está ocupado, el enlace público responde «ocupado» en vez de escribir a la vez');

  // ============ 7. Formulario nuevo ============
  console.log('\n[7] onFormSubmit con la pregunta «¿Cuál es tu relación con el colegio?»');
  const F = env.sheet('Respuestas de formulario 1'); env.outbox.length = 0;
  function enviarForm(titulos, extra = {}) {
    const nv = {};
    Object.entries(titulos).forEach(([k, v]) => { nv[k] = [v]; });
    // e.values sigue el orden REAL de las columnas de la hoja (las preguntas nuevas van al final)
    const nuevas = Object.keys(titulos).filter(k => !HDR_FORMS.includes(k));
    const vals = [new Date('2026-11-19T15:00:00Z'), ...HDR_FORMS.slice(1, 9).map(h => titulos[h] ?? ''), '', '', ...nuevas.map(k => titulos[k])];
    F.appendRow(HDR_FORMS.map(() => ''));              // fila en la hoja de respuestas (la numeración real no importa aquí)
    env.ctx.__e = { namedValues: nv, values: vals, range: { getRow: () => F.getLastRow() } };
    env.run('onFormSubmit(__e)');
  }
  const base = { 'Nombre completo': 'Laura', 'Correo electrónico donde recibirás respuesta y seguimiento de tu PQRS.': 'laura@mail.com', 'Teléfono': '3110000000',
    'Tipo de solicitud': 'Felicitación', 'Requiere respuesta': 'No', 'Descripción de la solicitud': 'Gracias por todo' };
  enviarForm({ ...base, '¿Cuál es tu relación con el colegio?': 'Colaborador' });
  let fila = P.rows[P.rows.length - 1]; const g = h => fila[P.col(h)];
  assert.equal(g('TipoSolicitante'), 'Colaborador'); assert.equal(g('Estudiante'), ''); assert.equal(g('Grado'), '');
  assert.equal(env.outbox[0].to, 'th@colegio.edu.co,rect@colegio.edu.co'); assert.ok(!/Estudiante/.test(env.outbox[0].body)); assert.ok(!/Estudiante/.test(env.outbox[1].body));
  assert.equal(env.outbox[1].to, 'laura@mail.com'); assert.equal(env.outbox[1].opts.replyTo, 'th@colegio.edu.co');
  ok('colaborador: queda en la bandeja de Talento Humano, sin datos de estudiante en la fila ni en los correos; la confirmación responde a Talento Humano');
  env.outbox.length = 0;
  enviarForm({ ...base, 'Nombre del estudiante': 'Sofía Pérez', 'Grado': 'Tercero A', 'Tipo de solicitante': 'Padre de familia' });
  fila = P.rows[P.rows.length - 1];
  assert.equal(g('TipoSolicitante'), 'Padre de familia'); assert.equal(g('Estudiante'), 'Sofía Pérez'); assert.equal(g('Grado'), 'Tercero A');
  assert.equal(env.outbox[0].to, 'sec@colegio.edu.co,rect@colegio.edu.co'); assert.ok(/Sofía Pérez/.test(env.outbox[1].body)); ok('padre de familia (título de pregunta distinto): bandeja de Secretaría, con estudiante y grado');
  enviarForm({ ...base, 'Cuál es tu relación con el colegio *': 'Estudiante', 'Nombre del estudiante': 'Él mismo', 'Grado': 'Sexto A' });
  fila = P.rows[P.rows.length - 1]; assert.equal(g('TipoSolicitante'), 'Estudiante'); ok('estudiante: se reconoce aunque el título cambie un poco');
  enviarForm({ ...base, '¿Cuál es tu relación con el colegio?': 'Proveedor o contratista' });
  fila = P.rows[P.rows.length - 1]; assert.equal(g('TipoSolicitante'), 'Proveedor o contratista'); ok('proveedor o contratista reconocido');
  enviarForm({ ...base, 'Nombre del estudiante': '', 'Grado': 'Colaborador' });                // formulario VIEJO todavía publicado
  fila = P.rows[P.rows.length - 1]; assert.equal(g('TipoSolicitante'), 'Colaborador'); assert.equal(g('Grado'), '');
  ok('mientras el formulario viejo siga publicado, «Colaborador» en Grado se convierte en tipo Colaborador');
  const ids2 = P.rows.slice(1).map(r => r[0]); assert.equal(new Set(ids2).size, ids2.length); ok('todos los IDs son únicos (' + ids2.length + ' solicitudes)');
  // La copia a Rectoría solo aplica a solicitudes NUEVAS y se puede apagar en Configuración
  const filaCopia = C.rows.findIndex(r => r[0] === 'copiarRectoria'); C.rows[filaCopia][1] = 'false'; env.outbox.length = 0;
  enviarForm({ ...base, '¿Cuál es tu relación con el colegio?': 'Visitante' });
  assert.equal(env.outbox[0].to, 'th@colegio.edu.co'); C.rows[filaCopia][1] = 'true';
  ok('con «copiarRectoria» apagado, la solicitud nueva avisa solo a su bandeja');

  // ============ 8. Correos y accesos ============
  console.log('\n[8] Correos al solicitante y observación al área');
  env.outbox.length = 0;
  const envC = env.get({ action: 'sendEmail', token: tTh, correo: 'x@mail.com', id: 'PQRS22600004', nombre: 'Proveedor', dependencia: 'Mantenimiento',
    segFecha: '2026-11-19', segRespuesta: 'Listo', segEstado: 'Cerrado', tipoSolicitante: 'Proveedor o contratista', estudiante: '', grado: '', contexto: 'respuesta' });
  assert.equal(envC.ok, true); const mc = env.outbox[0];
  assert.ok(!/Estudiante|Grado/.test(mc.body)); assert.equal(mc.opts.replyTo, 'th@colegio.edu.co'); assert.ok(!/tu familia/.test(mc.body));
  assert.ok(P.rowById('PQRS22600004')[P.col('TokenRespuesta')].startsWith('uuid-')); ok('correo a un proveedor: sin líneas de estudiante/grado, responde a Talento Humano, token guardado');
  P.rowById('PQRS22600004')[P.col('ObservacionSolicitante')] = 'obs';
  const x1 = env.get({ action: 'enviarObsArea', token: tSec, id: 'PQRS22600004' }); assert.equal(x1.ok, false); assert.match(x1.error, /acceso/i);
  ok('Secretaría NO puede enviar la observación de una solicitud de Talento Humano');
  P.rowById('PQRS22600004')[P.col('Dependencia')] = 'Coord. Preescolar';
  const x2 = env.get({ action: 'enviarObsArea', token: tTh, id: 'PQRS22600004' }); assert.equal(x2.ok, true, JSON.stringify(x2)); ok('Talento Humano sí puede con las suyas');

  // ============ 9. Importación desde la hoja del Forms (respaldo) ============
  console.log('\n[9] Respaldo: filas del Forms que no llegaron por el disparador');
  const F2 = env.sheet('Respuestas de formulario 1');
  F2.rows.push([...Array(HDR_FORMS.length).fill('')]); F2.rows[F2.rows.length - 1][0] = new Date('2026-11-20T09:00:00Z');
  F2.rows[F2.rows.length - 1][1] = 'Pendiente Uno'; F2.rows[F2.rows.length - 1][2] = 'u@mail.com'; F2.rows[F2.rows.length - 1][5] = 'Queja';
  F2.rows[0].push('¿Cuál es tu relación con el colegio?'); F2.rows[F2.rows.length - 1][F2.rows[0].length - 1] = 'Visitante';
  const dTh2 = env.get({ action: 'getData', token: tTh }); const dSec2 = env.get({ action: 'getData', token: tSec });
  const pend = dTh2.find(r => r.Nombre === 'Pendiente Uno'); assert.ok(pend); assert.equal(pend.TipoSolicitante, 'Visitante'); assert.equal(pend.Bandeja, 'talento');
  assert.ok(!dSec2.find(r => r.Nombre === 'Pendiente Uno')); ok('una fila pendiente del Forms aparece solo en la bandeja que le corresponde');
  const maxNum = Math.max(...P.rows.slice(1).map(r => Number(String(r[0]).replace('PQRS2260', ''))));
  assert.ok(Number(pend.ID.replace('PQRS2260', '')) > maxNum); ok('su ID no choca con ninguno existente o reservado');

  // ============ 10. Páginas públicas (solicitante y área) ============
  console.log('\n[10] Páginas públicas: correo de contacto de la bandeja correcta');
  const rowTh = P.rowById('PQRS22600004'); rowTh[P.col('TokenRespuesta')] = 'tk-pub'; rowTh[P.col('Estado')] = 'Proceso';
  const pagTh = env.run('doGet(__v)', { parameter: { action: 'responder', id: 'PQRS22600004', tkn: 'tk-malo' } });
  assert.ok(pagTh.html.includes('th@colegio.edu.co') && !pagTh.html.includes('secretaria@colegiogoyavier.edu.co'),
    'enlace vencido de un proveedor: correo de Talento Humano. mailto encontrados: ' + JSON.stringify(pagTh.html.match(/mailto:[^"]+/g)) + ' | estado fila: ' + P.rowById('PQRS22600004')[P.col('Estado')]);
  P.rowById('PQRS22600007')[P.col('Estado')] = 'Proceso';            // una solicitud cerrada no muestra correo de contacto
  const pagSec = env.run('doGet(__v)', { parameter: { action: 'responder', id: 'PQRS22600007', tkn: 'tk-malo' } });
  assert.ok(pagSec.html.includes('sec@colegio.edu.co') && !pagSec.html.includes('th@colegio.edu.co'));
  ok('el enlace del solicitante muestra el correo de contacto de SU bandeja (Talento Humano / Secretaría)');
  const pagOk = env.run('doGet(__v)', { parameter: { action: 'responder', id: 'PQRS22600004', tkn: 'tk-pub' } });
  assert.ok(pagOk.html.includes('mailto:th@colegio.edu.co'));
  ok('con token válido, la página de cierre/observación también apunta al correo de Talento Humano');
  const pagArea = env.run('doGet(__v)', { parameter: { action: 'responderArea', id: 'PQRS22600004', area: 'Mantenimiento' } });
  assert.ok(pagArea.html.includes('Descripción de la solicitud') && !/padre de familia/i.test(pagArea.html));
  ok('la página del área se genera bien y ya no habla de «padres de familia»');
  assert.equal(env.json(env.run('doGet(__v)', { parameter: { action: 'ping' } })), 'ok');

  // ============ 11. Enlace de acceso cuando la pantalla vive en otro sitio (Vercel) ============
  console.log('\n[11] URL_APP: aviso en el enlace de acceso antiguo');
  const normal = env.run('doGet(__v)', { parameter: {} });
  assert.equal(normal.file, 'PQRS-FINAL'); ok('sin URL_APP, Apps Script sigue sirviendo la pantalla como siempre');
  const env2 = crearEntorno(code.replace("const URL_APP       = '';", "const URL_APP       = 'https://pqrs-goyavier.vercel.app';"));
  const aviso = env2.run('doGet(__v)', { parameter: {} });
  assert.ok(aviso.html.includes('href="https://pqrs-goyavier.vercel.app"') && aviso.html.includes('target="_top"'));
  ok('con URL_APP, el enlace antiguo muestra un botón a la nueva dirección');
  const env3 = crearEntorno(code.replace("const URL_APP       = '';", "const URL_APP       = 'javascript:alert(1)';"));
  assert.equal(env3.run('doGet(__v)', { parameter: {} }).file, 'PQRS-FINAL'); ok('una URL_APP que no sea https:// se ignora');
  const enlaceRes = env2.run('doGet(__v)', { parameter: { action: 'ping' } }); assert.equal(env2.json(enlaceRes), 'ok');
  ok('los enlaces con parámetros (solicitante/área/API) no se ven afectados');

  // ============ 12. Hoja de respuestas reordenada (la que tiene hoy la base real) ============
  console.log('\n[12] Hoja de respuestas con otro orden de columnas + solicitudes antiguas con la relación rellenada a mano');
  const HDR_REAL = ['Marca temporal', '¿Cuál es tu relación con el colegio?', 'Correo electrónico donde recibirás respuesta y seguimiento de tu PQRS.  ', 'Teléfono  ',
    'Nombre del estudiante', 'Tipo de solicitud  ', 'Requiere respuesta', 'Descripción de la solicitud  ', 'Grado', 'Nombre ', 'Revisado', 'FormsID'];
  const e12 = crearEntorno(); sembrar(e12);
  const P12 = e12.sheet('PQRS'), F12 = new Sheet('Respuestas de formulario 1'); e12.sheets['Respuestas de formulario 1'] = F12;
  F12.appendRow(HDR_REAL);
  const filaF = (fid, rel) => { const o = HDR_REAL.map(() => ''); o[0] = '2026-10-01T15:00:00.000Z'; o[1] = rel; o[10] = true; o[11] = fid; return o; };
  F12.appendRow(filaF('fk-PQRS22600001', 'Padre de familia'));
  F12.appendRow(filaF('fk-PQRS22600002', 'Padre de familia'));
  F12.appendRow(filaF('fk-PQRS22600005', 'Colaborador'));
  F12.appendRow(filaF('fk-PQRS22600006', 'Colaborador'));
  e12.call('ensureHeaders', P12);                                   // la columna TipoSolicitante existe (vacía) antes de completarla
  const tipoDe = id => P12.rowById(id)[P12.col('TipoSolicitante')] ?? '';
  P12.rowById('PQRS22600002')[P12.col('TipoSolicitante')] = 'Estudiante';   // ya tenía tipo: la hoja de respuestas NO debe pisarlo
  e12.call('actualizarEstructura');
  assert.equal(tipoDe('PQRS22600001'), 'Padre de familia'); assert.equal(tipoDe('PQRS22600005'), 'Colaborador'); assert.equal(tipoDe('PQRS22600006'), 'Colaborador');
  assert.equal(tipoDe('PQRS22600002'), 'Estudiante'); assert.equal(tipoDe('PQRS22600003'), '');
  assert.ok(e12.logs.join('\n').includes('se completó «TipoSolicitante» en 3 solicitud'));
  ok('las solicitudes antiguas toman el tipo de la columna «¿Cuál es tu relación…?» de la hoja de respuestas (por FormsID, esté donde esté la columna)');
  ok('lo que ya tenía tipo no se pisa, y las que no están en la hoja de respuestas quedan como estaban');
  const copia12 = JSON.stringify(P12.rows); e12.call('actualizarEstructura'); assert.equal(JSON.stringify(P12.rows), copia12); ok('repetir actualizarEstructura no cambia nada más');

  const U12 = e12.sheet('UsuariosPQRS'), iPerf12 = U12.col('Perfil');
  U12.rows[3][iPerf12] = 'Rectoria';
  U12.appendRow(['th@colegio.edu.co', 'Talento Humano', 'ACTIVO', 'k-th', 'Talento Humano']);
  const tTh12 = e12.login('th@colegio.edu.co', 'k-th').token, tRect12 = e12.login('rectoria', 'k-rect').token;
  const dTh12 = e12.get({ action: 'getData', token: tTh12 });
  assert.equal(ids(dTh12), '05,06'); assert.equal(dTh12.find(r => r.ID.endsWith('06')).Grado, '');
  ok('Talento Humano ve las antiguas de colaboradores (05, 06) y la marca «Colaborador» ya no se muestra como grado');

  const T12 = { rel: HDR_REAL[1], correo: HDR_REAL[2], tel: HDR_REAL[3], est: HDR_REAL[4], tipo: HDR_REAL[5], req: HDR_REAL[6], desc: HDR_REAL[7], grado: HDR_REAL[8], nombre: HDR_REAL[9] };
  function enviar12(rel, nombre, estudiante, grado) {
    const resp = { [T12.rel]: rel, [T12.nombre]: nombre, [T12.correo]: 'x@mail.com', [T12.tel]: '3100000000', [T12.est]: estudiante, [T12.tipo]: 'Queja', [T12.req]: 'SI', [T12.desc]: 'Texto', [T12.grado]: grado };
    const fila = HDR_REAL.map((h, i) => i === 0 ? '2026-11-20T15:00:00.000Z' : (resp[h] ?? ''));
    const nv = {}; Object.entries(resp).forEach(([k, v]) => { if (v !== '') nv[k] = [v]; });       // Forms no manda lo que no se contestó
    F12.appendRow(fila); e12.outbox.length = 0;
    e12.ctx.__e = { namedValues: nv, values: fila, range: { getRow: () => F12.getLastRow() } };
    e12.run('onFormSubmit(__e)');
    return P12.rows[P12.rows.length - 1];
  }
  const g12 = (f, h) => f[P12.col(h)];
  let f12 = enviar12('Colaborador', 'Luis Colab', '', '');
  assert.equal(g12(f12, 'Nombre'), 'Luis Colab'); assert.equal(g12(f12, 'Correo'), 'x@mail.com'); assert.equal(g12(f12, 'Telefono'), 3100000000);
  assert.equal(g12(f12, 'TipoSolicitante'), 'Colaborador'); assert.equal(g12(f12, 'Estudiante'), ''); assert.equal(g12(f12, 'Grado'), '');
  assert.equal(e12.outbox[0].to, 'talentohumano@colegiogoyavier.edu.co,rectoria@colegiogoyavier.edu.co');
  ok('envío de colaborador con la hoja reordenada («Nombre » en la columna 10, títulos con espacios al final): campos en su sitio y aviso a Talento Humano + Rectoría');
  f12 = enviar12('Padre de familia', 'Carlos', 'Hijo Uno', 'Tercero A');
  assert.equal(g12(f12, 'Nombre'), 'Carlos'); assert.equal(g12(f12, 'Estudiante'), 'Hijo Uno'); assert.equal(g12(f12, 'Grado'), 'Tercero A'); assert.equal(g12(f12, 'TipoSolicitante'), 'Padre de familia');
  ok('envío de padre de familia con la hoja reordenada: estudiante y grado en su sitio');
  // Respuesta que el disparador no alcanzó a procesar: la importa getData leyendo por título
  const sinDisparador = HDR_REAL.map(() => ''); sinDisparador[0] = '2026-11-21T10:00:00.000Z'; sinDisparador[1] = 'Visitante'; sinDisparador[2] = 'v@mail.com';
  sinDisparador[3] = '3111111111'; sinDisparador[5] = 'Sugerencia'; sinDisparador[6] = 'NO'; sinDisparador[7] = 'Texto sin disparador'; sinDisparador[9] = 'Vera';
  F12.appendRow(sinDisparador);
  const imp12 = e12.get({ action: 'getData', token: tRect12 }).find(r => r.Descripcion === 'Texto sin disparador');
  assert.ok(imp12); assert.equal(imp12.Nombre, 'Vera'); assert.equal(imp12.Correo, 'v@mail.com'); assert.equal(imp12.TipoSolicitante, 'Visitante'); assert.equal(imp12.Bandeja, 'talento');
  ok('una respuesta sin procesar por el disparador se importa leyendo por título y cae en la bandeja de Talento Humano');

  console.log('\nTODAS LAS PRUEBAS PASARON (' + n + ' comprobaciones)');
})();
