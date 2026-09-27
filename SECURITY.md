# Política de seguridad

## Informar de una vulnerabilidad

Informa de las vulnerabilidades que sospeches en privado, mediante el
[informe privado de vulnerabilidades](https://github.com/espilber/duo180-office/security/advisories/new)
de este repositorio. No abras incidencias públicas para temas de seguridad.
Intentamos responder en un plazo de 72 horas.

## Postura de seguridad del proceso

Todas las ventanas de la aplicación se ejecutan con el bloqueo completo de
renderer de Electron:

- `contextIsolation: true`, `nodeIntegration: false` y `sandbox: true` en cada
  ventana de documento y pestaña (docs, sheets, slides, pdf, markdown, shell,
  actualizador).
- Los renderers solo llegan al proceso principal por canales IPC tipados y
  validados (las cargas se comprueban contra un esquema en el proceso
  principal; Sheets usa zod de principio a fin).
- Toda llamada a `shell.openExternal` pasa por una única puerta compartida
  (`@genoffice/electron-utils` → `safeExternalUrl`) que analiza la URL y aplica
  una lista blanca de protocolos (http/https; las anotaciones de enlaces de PDF
  permiten además `mailto`). Los esquemas `file:`, `javascript:` y
  personalizados se rechazan siempre.
- No hay claves de API ni credenciales de proveedores embebidas. Esta
  compilación no incluye proveedores de IA ni inicio de sesión, así que no hay
  material sensible que proteger.

## Modelo de amenaza: HTML no confiable en una ventana oculta

Cuando algún proceso necesita renderizar HTML que no viene de la propia
interfaz de la app (por ejemplo, la ruta de exportación de HTML a PowerPoint),
lo hace en una `BrowserWindow` oculta tratada como contenido hostil: bloqueo
completo del renderer (`sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`), sin script de preload y sin superficie IPC. El
proceso principal la controla exclusivamente mediante `executeJavaScript` y la
destruye con un temporizador de vigilancia.

## Fuera de alcance

- Vulnerabilidades que exijan una máquina ya comprometida o un binario
  modificado. Esto incluye los puntos de sobrescritura deliberada por variables
  de entorno para desarrollo local (`XLSX_SIDECAR_PATH`, `GENOFFICE_ALLOWED_ROOTS`):
  definirlas exige control del entorno del proceso, lo que equivale a ejecución
  de código en la máquina.
- Los problemas del propio proyecto original GenOffice es mejor informarlos
  [allí](https://github.com/genspark-ai/genoffice/security/advisories/new);
  si el mismo código es alcanzable en este fork, también queremos saberlo.
