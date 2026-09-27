# CLAUDE.md

Guía para agentes de IA y personas que trabajen en este repositorio.

Esto es **duo180 Office**, un fork de GenOffice (Apache-2.0) que avanza hacia
una suite ofimática más sencilla, sin la capa de IA del proyecto original. La
capa de motores no cambia respecto al original; las notas para contribuir están
en [CONTRIBUTING.md](CONTRIBUTING.md).

## Notas propias de este repositorio

- No hay IA dentro de las aplicaciones: ni paneles de chat, ni proveedores de
  modelos, ni registros de herramientas de agentes, ni puentes de control
  MCP/CLI. No reintroduzcas llamadas a modelos en las apps.
- La capa de operaciones de edición que comparten la ribbon, los diálogos y los
  tests vive en `apps/docs/src/renderer/ops/` (registro de operaciones,
  operaciones de tabla/campos/estilos/notas/comentarios, análisis de fragmentos
  HTML y aplicación de cambios con control de cambios). **No** es código de IA:
  manténla independiente de la interfaz y de cualquier modelo.
- La búsqueda local de archivos (índice sobre nombres, carpetas y texto
  extraído) es una función del producto, no IA: se apoya en
  `packages/file-parse` y en `apps/shell/src/main/file-index/`. Mantenla
  funcionando.

## Reglas de tematización (obligatorias)

La suite soporta temas de interfaz claro / oscuro / sistema. El mecanismo de
cambio es un atributo `data-theme` en `<html>` más propiedades personalizadas
de CSS definidas una sola vez en `packages/ui/src/tokens.css` (valores claros
por defecto en `:root`, variantes en `[data-theme='dark']` y un respaldo por
media query `prefers-color-scheme` para el modo sistema).

1. **Los colores de la interfaz deben usar tokens semánticos.** No escribas
   `#hex` / `rgb()` en crudo en las reglas CSS del renderer ni en estilos
   inline de la interfaz: usa `var(--surface)`, `var(--text)`, `var(--hover)`,
   etc. de `packages/ui/src/tokens.css`. Los valores en crudo solo se permiten
   en las líneas que definen una propiedad personalizada (`--x: #...;`).
   La integración continua lo comprueba en las líneas nuevas o cambiadas
   (`tools/check-theme-colors.mjs`).
2. **Todo token nuevo lleva sus dos valores.** Añadir un token significa
   añadirlo a los tres bloques de `tokens.css` (claro, oscuro y respaldo del
   sistema en oscuro).
3. **Los colores de acento son de cada app.** Cada app define `--accent` /
   `--accent-dark` / `--accent-soft` (y sus variantes oscuras) en su propio
   `styles.css`. Las reglas compartidas referencian `var(--accent)` y heredan
   el color de marca de la app.
4. **El tema nunca reescribe el contenido del documento.** Superficies de
   página, rellenos de celda, contenido de diapositivas, mapas de bits de
   páginas PDF, hojas de estilo de exportación e impresión, paletas de
   gráficos, mapas de colores de resaltado, sellos y ajustes prediseñados de
   WordArt son datos del documento: se quedan fijos, no deben referenciar
   tokens de la interfaz y toda ruta de guardar/exportar/imprimir debe producir
   el mismo resultado en ambos temas. Una _página oscura_ al estilo de
   Word/Excel (Sheets mediante `darkMode` de Univer, Docs mediante
   `apps/docs/src/renderer/editor/dark-page.ts`) es solo una transformación de
   visualización: el color declarado sigue siendo el real, su gemelo
   transformado vive en una capa `--dk-*` / `.page-dark` solo para pantalla, y
   ni la impresión ni la exportación la ven.
5. **Los elementos dibujados en canvas pasan por una tabla de constantes.** Los
   adornos de edición en Konva/canvas (marcos de selección, guías, tiradores)
   se leen de la tabla de colores de canvas de cada app (por ejemplo
   `canvas-colors.ts`), indexada por el tema actual: nada de hex en crudo en
   las llamadas de dibujo.

## Trampas de compilación

- El código del proceso principal de cada app (`apps/*/src/main`) se compila
  dentro de la build del **shell**. Tras cambiarlo hay que recompilar el shell,
  o el cambio no se ejecuta y no te darás cuenta.
- En modo desarrollo, los cambios de preload necesitan recompilación: un
  preload obsoleto deja el renderer en blanco.
- Los paquetes del workspace que aparecen en las `dependencies` de una app
  también deben estar en la lista `exclude` de `externalizeDepsPlugin`, o la
  app empaquetada falla al arrancar.
- El `t` de `useI18n()` no es referencialmente estable: no lo pongas nunca en
  el array de dependencias de un hook. Guarda la clave y traduce al renderizar.

## Textos de interfaz (i18n)

- Los diccionarios grandes están troceados por idioma:
  `i18n/strings-<dominio>.ts` es un agregador fino sobre
  `i18n/<dominio>/<idioma>.ts` (un archivo por idioma y `zh` define el conjunto
  de claves). Añade una clave nueva a `zh.ts` y a cada archivo hermano; el
  `satisfies Record<keyof typeof zh, string>` de cada archivo convierte una
  clave que falta o sobra en un error de tipos. No vuelvas a convertir el
  agregador en un único objeto con todos los idiomas.
