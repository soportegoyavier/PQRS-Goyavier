# Pruebas automáticas

No necesitan Google: el backend corre contra una hoja de cálculo simulada y el cliente contra un servidor simulado.

| Archivo | Qué comprueba | Cómo correrlo |
|---|---|---|
| `prueba_backend.js` | Perfiles y bandejas, guardado sin pisar datos, seguimientos, IDs, formulario, correos, enlaces públicos | `node pruebas/prueba_backend.js` |
| `prueba_cliente.py` | Pantallas en un navegador real (Playwright): perfil, nueva solicitud, bandeja, descartar, configuración, sesión vencida | `python pruebas/prueba_cliente.py` (requiere `pip install playwright` y `playwright install chromium`) |

Correrlas siempre después de tocar `CODE-APPS-SCRIPT-FINAL.gs` o `PQRS-FINAL.html`, junto con
`python sincronizar_script_embebido.py --check`.
