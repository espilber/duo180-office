# Privacidad de duo180 Office

Última actualización: 27 de septiembre de 2026

duo180 Office es un fork de [GenOffice](https://github.com/genspark-ai/genoffice).
Este documento describe lo que hace la compilación de duo180, no lo que hace el
proyecto original.

## Tus documentos se quedan en tu equipo

Abrir, editar y guardar documentos es local. Tus archivos `.docx`, `.xlsx`,
`.pptx`, PDF, Markdown y HTML se leen y se escriben en tu disco y la aplicación
no los sube a ningún sitio.

El índice de búsqueda local de archivos (nombres, carpetas y texto extraído, en
una base de datos SQLite) se construye y se consulta en tu equipo. Nunca sale
de él.

## Sin IA y sin cuentas

Esta compilación no tiene funciones de IA: ni proveedores de modelos, ni panel
de chat, ni inicio de sesión. No habla con ningún servicio de IA y no necesita
ninguna clave de API.

## Sin analítica de uso

Esta compilación **no incluye analítica de uso, telemetría, informes de errores
ni identificadores publicitarios**. No se envía al proyecto duo180 ni a
terceros nada sobre cómo usas la aplicación, así que no hay ningún ajuste de
analítica que desactivar.

## Acceso a la red

La aplicación no hace peticiones de red para trabajar con tus documentos. El
único tráfico saliente que inicia es:

- **Comprobación de actualizaciones.** La app puede preguntar a GitHub Releases
  por la última versión publicada para avisarte de si hay una actualización.
  Es una petición HTTPS normal a `github.com`, no lleva datos de documentos y
  se puede desactivar.
- **Enlaces que abres.** Al abrir un hipervínculo de un documento, la URL pasa
  a tu navegador del sistema a través de una lista blanca (http/https; las
  anotaciones de PDF permiten además `mailto`). Los esquemas `file:`,
  `javascript:` y personalizados se rechazan.

Si compilas desde el código fuente, puedes verificar todo lo anterior en este
repositorio.

## Lo que nunca se envía

- el contenido de los documentos
- nombres o rutas de archivos
- una identidad, cuenta o dirección de correo
- un identificador de dispositivo o de instalación

## Cambios

Si esta política cambia, la actualización llegará a este mismo archivo con una
fecha nueva.
