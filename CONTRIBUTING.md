# Contribuir a duo180 Office

Gracias por tu interés en contribuir.

duo180 Office es un **fork de [GenOffice](https://github.com/genspark-ai/genoffice)**
(Apache-2.0) que avanza hacia una suite ofimática más sencilla: edición nativa
de `.docx`, `.xlsx` y `.pptx` con ida y vuelta que conserva los bytes, y sin la
capa de IA del proyecto original. El código y la licencia originales se
conservan; consulta [LICENSE](LICENSE) y [NOTICE](NOTICE).

Este repositorio es un repositorio normal de GitHub: `main` es la rama de
desarrollo y los pull requests se revisan y se fusionan aquí. No hay espejo, ni
árbol privado, ni CLA: al contribuir aceptas que tu aportación se licencie bajo
Apache-2.0 (lo que entra, sale con la misma licencia).

## Estructura del repositorio

- `apps/*` — las aplicaciones Electron (docs, sheets, slides, pdf, markdown,
  html, shell). Cada app es un workspace de npm con su propio `src/main`
  (proceso principal de Electron), `src/renderer` (interfaz React) y `tests/`.
- `packages/*` — paquetes de motores y compartidos en TypeScript puro (sin
  dependencia de Electron, con tests unitarios): motores docx/pptx, pasarela
  xlsx, pdf2docx, html2docx, extracción de texto para el índice de búsqueda,
  i18n y kit de interfaz.
- `apps/sheets/native/xlsx-engine` — motor `.xlsx` en Rust (se ejecuta como
  proceso auxiliar) para importar y exportar xlsx.

### Paquetes de motores

Todos en TypeScript puro, sin dependencia de Electron y con tests unitarios
(excepto el kit de interfaz):

- `packages/docx-engine` — análisis de docx → árbol de bloques (con anclas
  `docxIndex` y passthrough), generación de fragmentos OOXML y parcheo de
  párrafos a nivel de byte.
- `packages/pptx-engine` / `packages/pptx-render` / `packages/pptx-ops` —
  modelo, renderizado y operaciones de edición de pptx.
- `packages/xlsx-gateway` — pasarela en TypeScript hacia el motor xlsx de Rust.
- `packages/pdf2docx` — conversión local de PDF a DOCX: extracción de
  caracteres con PDFium, análisis de maquetación por geometría pura y
  reconstrucción con `docx-engine`; el mismo análisis alimenta las
  exportaciones a PowerPoint y Excel de la app PDF.
- `packages/html2docx` — conversión local de HTML a DOCX: la página se renderiza
  en el Chromium de la propia app, se reduce en el navegador a un árbol de
  intención de documento y se escribe como OOXML nativo con la librería `docx`.
  Alimenta la exportación a Word de la app HTML y el tratamiento de `altChunk`
  de Word en `docx-engine`.
- `packages/file-parse` — extracción de texto para el índice local de búsqueda
  de archivos (formatos ofimáticos y de texto).
- `packages/i18n`, `packages/ui`, `packages/project-store`,
  `packages/electron-utils`, `packages/font-metrics` — núcleo de i18n, kit de
  interfaz, almacén de archivos recientes, utilidades para el proceso principal
  de Electron y métricas de fuentes.

### Notas de arquitectura (ida y vuelta de docx)

```
abrir .docx ─► se archiva el original por hash (nunca se toca)
            ─► docx-engine analiza los elementos de nivel superior de
               word/document.xml (w:p / w:tbl / …)
            ─► árbol de bloques, cada bloque anclado por docxIndex + su
               fragmento XML original
            ─► editor Tiptap (edición manual, seguimiento de cambios sucios)
guardar     ─► los bloques sucios → fragmentos OOXML (solo estilos existentes)
            ─► se insertan en el document.xml original; los bloques intactos
               conservan sus bytes originales
            ─► se reempaqueta el zip; todas las demás entradas se copian byte a byte
```

La misma filosofía se aplica en hojas y presentaciones: el archivo original es
la fuente de verdad, las ediciones se aplican como parches estrechos y todo lo
que el editor no ha tocado sobrevive intacto a la ida y vuelta.

## Puesta en marcha

Requisitos: Node 22 o superior (se recomienda 24), npm 10+ y un toolchain de
Rust (`cargo` en el PATH), necesario solo para el motor xlsx de Sheets. En
Windows, el objetivo MSVC de Rust requiere además las Build Tools de Visual
Studio con la carga de trabajo de C++.

```bash
npm install
npm run fixtures     # genera los .docx de prueba (una vez, y tras tocar docx-engine)
npm run dev          # todos los editores + el contenedor con servidores Vite
npm run dev:docs     # o una sola app
```

## Comprobaciones que debe pasar cualquier cambio

La integración continua las ejecuta en cada pull request; ejecútalas en local
antes de subir nada:

```bash
npm run format:check # formato (Prettier) de archivos nuevos o modificados
npm run lint         # ESLint en todo el repositorio (0 errores; avisos permitidos)
npm run typecheck    # tsc --noEmit en cada workspace
npm test             # tests unitarios de motores y apps (incluye los del motor Rust)
npm run licenses     # licencias de dependencias dentro de la lista permitida
```

## Convenciones de código

- **Idioma:** código, identificadores y comentarios en **inglés**;
  documentación del repositorio y mensajes de commit en **español**. Los textos
  de cara al usuario van por los recursos de i18n
  (`apps/*/src/renderer/i18n/`, además de los diccionarios del proceso principal
  en `src/main/`), que es el único sitio donde debe haber texto en otros
  idiomas (aparte de los textos de los archivos de prueba).
- TypeScript en todas partes; evita introducir nuevos `any` cuando un tipo
  preciso sea barato.
- Los tests viven en `apps/*/tests` y `packages/*/tests` (vitest). Un cambio de
  motor necesita test unitario; los retoques de interfaz normalmente no.
- Evita que los archivos crezcan sin límite: si añades una preocupación nueva y
  grande a un archivo ya enorme, mejor un módulo aparte.
- Las reglas de tematización, el troceado de los diccionarios de i18n y las
  trampas de compilación están en [CLAUDE.md](CLAUDE.md): léelo antes de tocar
  CSS del interfaz, diccionarios de i18n o el proceso principal de una app.

## Commits y pull requests

- Commits pequeños y enfocados, con asunto en imperativo y en español
  (por ejemplo `arregla la ida y vuelta de bordes de tabla en docx`).
- Un pull request debe explicar _por qué_ hace falta el cambio y mencionar cuál
  de las comprobaciones anteriores has ejecutado.
- La fidelidad de formato es la promesa central del producto: en cambios que
  toquen rutas de abrir/guardar (docx/xlsx/pptx), incluye un test de ida y
  vuelta que demuestre que el contenido intacto sobrevive byte a byte.

## Informar de errores y pedir funciones

Usa las incidencias (Issues) de este repositorio. Si sospechas de un problema
de seguridad, **no** abras una incidencia pública: sigue [SECURITY.md](SECURITY.md).

## Código de conducta

Todos los espacios del proyecto siguen el [Pacto de Contribuyentes](CODE_OF_CONDUCT.md);
participar implica aceptarlo.

## Licencia

Apache License 2.0 — consulta [LICENSE](LICENSE).
