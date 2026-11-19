#!/usr/bin/env python3
"""
Regenera la copia embebida del backend (const APPS_SCRIPT_CODE) dentro de PQRS-FINAL.html
a partir de CODE-APPS-SCRIPT-FINAL.gs.

El archivo .gs es la ÚNICA fuente del backend: nunca edite a mano la copia embebida.
Hacerlo a mano fue lo que dejó ambas versiones desfasadas (ver skill regression-guardian).

Uso:
    python sincronizar_script_embebido.py          reescribe el HTML con la copia actualizada
    python sincronizar_script_embebido.py --check  solo verifica; termina con código 1 si hay diferencias
"""
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent
GS = RAIZ / "CODE-APPS-SCRIPT-FINAL.gs"
HTML = RAIZ / "PQRS-FINAL.html"
INICIO = "const APPS_SCRIPT_CODE = `"
FIN = "\n`;"


def escapar(js: str) -> str:
    """Escapa el código para incrustarlo dentro de un template literal dentro de un <script>.

    Además de la barra invertida, el acento grave y ${, hay que escribir «</script» como «<\\/script»:
    si no, el navegador cierra el bloque <script> del HTML en la primera cadena '</script>' del
    código y la aplicación deja de funcionar.
    """
    out = js.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    return out.replace("</script", "<\\/script").replace("</SCRIPT", "<\\/SCRIPT")


def desescapar(lit: str) -> str:
    lit = lit.replace("<\\/script", "</script").replace("<\\/SCRIPT", "</SCRIPT")
    return lit.replace("\\${", "${").replace("\\`", "`").replace("\\\\", "\\")


def main() -> int:
    solo_verificar = "--check" in sys.argv[1:]
    gs = GS.read_bytes().decode("utf-8").replace("\r\n", "\n")
    if not gs.endswith("\n"):
        gs += "\n"
    html_bytes = HTML.read_bytes().decode("utf-8")
    crlf = "\r\n" in html_bytes
    html = html_bytes.replace("\r\n", "\n")

    if html.count(INICIO) != 1:
        print("ERROR: no se encontró (o hay más de una) 'const APPS_SCRIPT_CODE = `' en el HTML.")
        return 2
    i = html.index(INICIO) + len(INICIO)
    j = html.index(FIN, i)                      # el contenido escapado nunca contiene un acento grave sin escapar
    actual = html[i:j] + "\n"
    nuevo = escapar(gs)

    if actual == nuevo:          # comparación exacta del texto ya escapado (así también detecta un escape mal hecho)
        print("OK: la copia embebida ya coincide con CODE-APPS-SCRIPT-FINAL.gs.")
        return 0
    if solo_verificar:
        a, b = desescapar(actual).splitlines(), gs.splitlines()
        print(f"DIFERENCIAS: la copia embebida ({len(a)} líneas) NO coincide con el .gs ({len(b)} líneas).")
        print("Ejecute:  python sincronizar_script_embebido.py")
        return 1

    html = html[:i] + nuevo[:-1] + html[j:]
    HTML.write_bytes((html.replace("\n", "\r\n") if crlf else html).encode("utf-8"))
    print(f"Copia embebida actualizada: {len(gs.splitlines())} líneas, {len(gs):,} caracteres.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
