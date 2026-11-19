"""Prueba del cliente (PQRS-FINAL.html) en un navegador real, con el servidor de Apps Script simulado."""
import json, pathlib, sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

HTML = pathlib.Path(__file__).resolve().parent.parent / "PQRS-FINAL.html"
import tempfile
SHOTS = pathlib.Path(tempfile.gettempdir())
CORS = {"access-control-allow-origin": "*", "content-type": "application/json"}

def fila(id, tipo, estado='Borrador', est='', grado='', nombre=None):
    return {"ID": id, "Fecha": "2026-11-18", "Dependencia": "", "Nombre": nombre or f"Persona {id[-2:]}", "Telefono": "3001112233", "Correo": f"p{id[-2:]}@mail.com",
            "Estudiante": est, "Grado": grado, "TipoSolicitud": "Queja", "MedioRecepcion": "Forms", "RequiereRespuesta": "Si", "Descripcion": "Texto de prueba " + id,
            "Estado": estado, "EmailPendiente": "FALSE", "CreadoEn": "2026-11-18T15:00:00.000Z", "OrigenForms": "TRUE", "ObservacionSolicitante": "",
            "FechaObservacion": "", "FormsKey": "fk" + id[-2:], "Calificacion": "", "TipoSolicitante": tipo,
            "Bandeja": "secretaria" if tipo in ("Padre de familia", "Estudiante") else "talento", "seguimientos": []}

DATOS = {
    "Secretaria": [fila("PQRS22600001", "Padre de familia", est="Sofía Pérez", grado="Tercero A"), fila("PQRS22600002", "Estudiante", est="Él mismo", grado="Sexto A")],
    "Talento Humano": [fila("PQRS22600003", "Colaborador"), fila("PQRS22600004", "Proveedor o contratista"), fila("PQRS22600005", "Visitante", estado="Cerrado")],
    "Rectoria": [fila("PQRS22600001", "Padre de familia", est="Sofía Pérez", grado="Tercero A"), fila("PQRS22600003", "Colaborador")],
}
CONFIG = {"diasRespuesta": 15, "alertaDias": 2, "emailAreas": {"Coord. Preescolar": "coord@x.com"}, "dependencias": ["Coord. Preescolar", "Secretaria"],
          "emailPerfiles": {"secretaria": "sec@x.com", "talentoHumano": "th@x.com", "rectoria": "rect@x.com"}, "copiarRectoria": True}

resultados = []
def ok(msg): resultados.append(msg); print("  ✓", msg)

def correr(p, perfil):
    print(f"\n[{perfil}]")
    estado = {"posts": [], "datos": list(DATOS[perfil]), "expirar": False}
    navegador = p.chromium.launch()
    page = navegador.new_page(viewport={"width": 1400, "height": 900})
    errores = []
    page.on("pageerror", lambda e: errores.append(str(e)))
    page.on("dialog", lambda d: d.accept())

    def servidor(route):
        req = route.request
        q = parse_qs(urlparse(req.url).query)
        a = (q.get("action") or [""])[0]
        if req.method == "POST":
            estado["posts"].append(json.loads(req.post_data or "{}"))
            return route.fulfill(status=200, headers=CORS, body="")
        if a == "login":
            return route.fulfill(status=200, headers=CORS, body=json.dumps({"ok": True, "token": "tok-" + perfil, "email": "u@x.com", "nombre": "Usuario " + perfil, "role": perfil, "perfil": perfil}))
        if a == "getConfig": return route.fulfill(status=200, headers=CORS, body=json.dumps(CONFIG))
        if a == "getData":
            if estado["expirar"]:
                return route.fulfill(status=200, headers=CORS, body=json.dumps({"ok": False, "authorized": False, "error": "Sesión vencida. Inicie sesión nuevamente."}))
            return route.fulfill(status=200, headers=CORS, body=json.dumps(estado["datos"]))
        if a == "nextId": return route.fulfill(status=200, headers=CORS, body=json.dumps({"ok": True, "id": "PQRS22609999"}))
        return route.fulfill(status=200, headers=CORS, body=json.dumps({"ok": True}))
    page.route("https://script.google.com/**", servidor)
    page.route("https://accounts.google.com/**", lambda r: r.abort())

    page.goto(HTML.as_uri(), wait_until="domcontentloaded")
    page.wait_for_selector("#login-overlay", state="visible")
    page.fill("#login-usuario", "usuario"); page.fill("#login-clave", "clave")
    page.evaluate("loginTradicional()")
    page.wait_for_selector("#login-overlay", state="hidden", timeout=15000)
    page.wait_for_function("document.getElementById('app-loader').style.display === 'none'", timeout=15000)

    nombre_perfil = {"Secretaria": "Secretaría", "Talento Humano": "Talento Humano", "Rectoria": "Rectoría"}[perfil]
    assert nombre_perfil in page.inner_text("#user-perfil"), page.inner_text("#user-perfil")
    ok(f"la barra lateral muestra el perfil «{nombre_perfil}»")

    # --- Nueva solicitud: tipo de solicitante por defecto y campos de estudiante condicionales
    page.evaluate("showView('nueva')")
    por_defecto = {"Secretaria": "Padre de familia", "Talento Humano": "Colaborador", "Rectoria": ""}[perfil]
    assert page.input_value("#f-solicitante") == por_defecto
    visible = lambda sel: page.is_visible(sel)
    esperado_est = por_defecto in ("Padre de familia", "Estudiante")
    assert visible("#f-estudiante") == esperado_est and visible("#f-grado") == esperado_est
    ok(f"«Nueva solicitud» arranca con tipo «{por_defecto or '(sin elegir)'}» y {'muestra' if esperado_est else 'oculta'} estudiante/grado")
    page.select_option("#f-solicitante", "Estudiante"); assert visible("#f-estudiante") and visible("#f-grado")
    page.select_option("#f-solicitante", "Visitante"); assert not visible("#f-estudiante") and not visible("#f-grado")
    page.select_option("#f-solicitante", "Padre de familia"); assert visible("#f-estudiante")
    ok("al cambiar el tipo, estudiante y grado aparecen solo para «Padre de familia» y «Estudiante»")
    page.wait_for_timeout(900); page.screenshot(path=str(SHOTS / f"cli_nueva_{perfil.replace(' ', '_')}.png"))

    # --- Guardar: sin datos de estudiante para un visitante; con ellos para un padre
    def llenar(tipo, est="", grado=""):
        page.evaluate("clearForm()")
        page.select_option("#f-solicitante", tipo)
        page.fill("#f-nombre", "Ana Prueba"); page.fill("#f-telefono", "3001234567"); page.fill("#f-correo", "ana@mail.com")
        page.select_option("#f-dependencia", "Coord. Preescolar"); page.select_option("#f-tiposolicitud", "Queja")
        page.select_option("#f-medio", "Verbal"); page.select_option("#f-requiere", "Si"); page.fill("#f-descripcion", "Descripción de prueba")
        if est: page.fill("#f-estudiante", est)
        if grado: page.fill("#f-grado", grado)
    llenar("Visitante")
    n0 = len(estado["posts"])
    page.evaluate("guardarSolicitud()")
    page.wait_for_function("document.getElementById('modal-consecutivo').textContent === 'PQRS22609999'", timeout=8000)
    page.wait_for_timeout(300)
    sync = [x for x in estado["posts"][n0:] if x.get("action") == "sync"][-1]
    nueva = next(s for s in sync["data"] if s["id"] == "PQRS22609999")
    assert nueva["tipoSolicitante"] == "Visitante" and nueva["estudiante"] == "" and nueva["grado"] == ""
    assert sync["token"] == "tok-" + perfil and sync["eliminados"] == []
    ok("un visitante se guarda SIN estudiante/grado y con el consecutivo que asignó el servidor (PQRS22609999)")
    page.evaluate("closeModal('modal-guardar')")
    llenar("Padre de familia")                                         # faltan estudiante y grado → debe rechazarse
    n1 = len(estado["posts"]); page.evaluate("guardarSolicitud()"); page.wait_for_timeout(500)
    assert len(estado["posts"]) == n1 and "input-error" in page.get_attribute("#f-estudiante", "class")
    ok("a un padre de familia SÍ se le exige nombre del estudiante y grado")

    # --- Bandeja: etiquetas y datos de estudiante según el tipo
    page.evaluate("showView('bandeja')")
    html_b = page.inner_html("#bandeja-list")
    tipos = {"Secretaria": ["Padre de familia", "Estudiante"], "Talento Humano": ["Colaborador", "Proveedor o contratista"], "Rectoria": ["Padre de familia", "Colaborador"]}[perfil]
    assert all(t in html_b for t in tipos), html_b[:300]
    if perfil == "Talento Humano": assert "Estudiante:" not in html_b
    if perfil == "Secretaria": assert "Sofía Pérez" in html_b and "Tercero A" in html_b
    if perfil == "Rectoria": assert "Sofía Pérez" in html_b and html_b.count("🎓 Estudiante") == 1      # solo la del padre, no la del colaborador
    ok("la bandeja muestra el tipo de cada solicitante" + (" y nunca datos de estudiante para colaboradores/proveedores" if perfil != "Secretaria" else " con su estudiante y grado"))
    page.wait_for_timeout(900); page.screenshot(path=str(SHOTS / f"cli_bandeja_{perfil.replace(' ', '_')}.png"))

    # --- Descartar un borrador: se pide el borrado de forma explícita y no «revive»
    victima = estado["datos"][0]["ID"]; n2 = len(estado["posts"])
    page.evaluate(f"rechazarBorrador('{victima}')"); page.wait_for_timeout(500)
    sync = [x for x in estado["posts"][n2:] if x.get("action") == "sync"][-1]
    assert victima in sync["eliminados"] and victima not in [s["id"] for s in sync["data"]]
    ok(f"«Descartar» envía el borrado explícito ({victima}) y la solicitud sale del conjunto guardado")
    page.evaluate("pullFromSheets(false)"); page.wait_for_timeout(500)                      # el servidor aún la devuelve
    assert victima not in page.evaluate("DB.solicitudes.map(s => s.id)")
    ok("si el servidor todavía la devuelve en la siguiente lectura, no reaparece en pantalla")
    estado["datos"] = [d for d in estado["datos"] if d["ID"] != victima]
    page.evaluate("pullFromSheets(false)"); page.wait_for_timeout(500)
    assert page.evaluate("_eliminadosPendientes.length") == 0
    ok("cuando el servidor confirma el borrado, se deja de reenviar")

    # --- Detalle de la solicitud con datos de estudiante solo cuando aplica
    estado["datos"].append(fila("PQRS22600077", "Visitante" if perfil != "Secretaria" else "Padre de familia", estado="Proceso",
                                est="" if perfil != "Secretaria" else "Hijo Uno", grado="" if perfil != "Secretaria" else "Quinto A"))
    page.evaluate("pullFromSheets(false)"); page.wait_for_timeout(500)
    page.evaluate("showView('seguimiento')"); page.wait_for_timeout(300)
    html_s = page.inner_html("#view-seguimiento")
    con_est = perfil == "Secretaria"
    assert ("<label>Estudiante</label>" in html_s) == con_est
    assert "Tipo de solicitante" in html_s
    ok("el seguimiento muestra «Tipo de solicitante»" + (" con estudiante y grado" if con_est else " sin filas de estudiante/grado"))

    # --- Configuración: correos por perfil
    page.evaluate("showView('config')"); page.wait_for_timeout(300)
    assert page.input_value("#cfg-email-th") == "th@x.com" and page.input_value("#cfg-email-secretaria") == "sec@x.com"
    page.fill("#cfg-email-th", "nuevo_th@x.com"); n3 = len(estado["posts"]); page.evaluate("saveConfig()"); page.wait_for_timeout(500)
    cfg = [x for x in estado["posts"][n3:] if x.get("action") == "saveConfig"][-1]["config"]
    assert cfg["emailPerfiles"]["talentoHumano"] == "nuevo_th@x.com" and cfg["emailPerfiles"]["rectoria"] == "rect@x.com" and cfg["copiarRectoria"] is True
    ok("Configuración carga y guarda los correos de Secretaría / Talento Humano / Rectoría")
    page.locator("text=Avisos por perfil").first.scroll_into_view_if_needed(); page.wait_for_timeout(900)
    page.screenshot(path=str(SHOTS / f"cli_config_{perfil.replace(' ', '_')}.png"), full_page=False)
    assert page.locator("text=Borrar todos los datos").count() == 0
    ok("el botón «Borrar todos los datos» ya no existe")

    # --- Sesión vencida o sin perfil → vuelve al ingreso
    estado["expirar"] = True; page.evaluate("pullFromSheets(false)"); page.wait_for_timeout(600)
    assert page.is_visible("#login-overlay")
    ok("si la sesión venció (o es anterior a los perfiles), vuelve a la pantalla de ingreso")

    assert not errores, errores
    ok("sin errores de JavaScript en la consola")
    navegador.close()

with sync_playwright() as p:
    for perfil in ("Secretaria", "Talento Humano", "Rectoria"):
        correr(p, perfil)
print(f"\nTODAS LAS PRUEBAS DEL CLIENTE PASARON ({len(resultados)} comprobaciones)")
