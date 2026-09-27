# duo180 Office

Suite ofimática de escritorio que abre, edita y guarda los formatos nativos de
Microsoft Office —`.docx`, `.xlsx` y `.pptx`— además de PDF, Markdown y HTML.
Sin funciones de IA.

Pensada para Windows, macOS y Linux.

> **Estado:** proyecto en desarrollo (alpha). Está construida sobre los motores
> de GenOffice y en estos momentos se está simplificando: se retira la capa de
> IA del proyecto original y se recorta la interfaz.

## Qué incluye

- **Docs** — procesador de textos para `.docx`: estilos, tablas, imágenes,
  cabeceras y pies de página, comentarios, control de cambios, notas al pie,
  índices y ecuaciones.
- **Sheets** — hojas de cálculo para `.xlsx`: fórmulas vivas, gráficos, tablas,
  formato condicional, validación de datos y filtros.
- **Slides** — presentaciones para `.pptx`: patrones y diseños, guías de
  alineación y recorte no destructivo.
- **PDF** — lectura y edición de texto dentro de la página, y conversión en el
  equipo de PDF a Word, Excel o PowerPoint.
- **Markdown** — editor de bloques sobre `.md`, con tablas, listas de tareas y
  diagramas, y exportación local a Word.
- **Búsqueda local** — encuentra archivos por su contenido, no solo por el
  nombre: índice en el equipo (SQLite) sobre el texto extraído de documentos
  Word, Excel, PowerPoint, PDF, Markdown y HTML.

## Los formatos Office se respetan de verdad

El archivo original es la fuente de verdad. Al guardar, solo se reescriben los
fragmentos que has editado; todo lo demás se copia **byte a byte**:

```
abrir .docx ─► se archiva el original por hash (nunca se toca)
            ─► se analiza word/document.xml y se construye el árbol de bloques
            ─► edición (cada bloque queda anclado a su XML original)
guardar     ─► los bloques modificados se convierten en fragmentos OOXML
            ─► se insertan en el document.xml original; el resto conserva sus bytes
            ─► se reempaqueta el zip; las demás entradas se copian tal cual
```

Esto es lo que permite que un documento editado en duo180 siga abriéndose sin
sorpresas en Word, Excel y PowerPoint: estilos, numeraciones, campos y
contenido que el editor no ha tocado sobreviven intactos.

## Sin IA y sin telemetría

- No hay panel de IA, ni proveedores de modelos, ni cuentas, ni claves de API.
- No hay analítica de uso, ni identificadores de dispositivo ni informes de
  errores.
- Tus documentos no salen del equipo: abrir, editar, guardar, convertir y
  buscar ocurre en local. La única conexión de salida es la comprobación de
  actualizaciones contra GitHub (ver [PRIVACY.md](PRIVACY.md)).

## Desarrollo

Requisitos: Node 22 o superior (se recomienda 24), npm 10+, y un toolchain de
Rust (`cargo` en el PATH), necesario solo para el motor `.xlsx` de Sheets. En
Windows, el objetivo MSVC de Rust requiere además las Build Tools de Visual
Studio con la carga de trabajo de C++.

```bash
npm install
npm run fixtures     # genera los .docx de prueba (una vez, y tras tocar docx-engine)
npm run dev          # todos los editores + el contenedor con servidores Vite
npm run dev:docs     # o una sola app
```

Comprobaciones que debe pasar cualquier cambio:

```bash
npm run format:check # formato (Prettier) de archivos nuevos o modificados
npm run lint         # ESLint en todo el repositorio
npm run typecheck    # tsc --noEmit en cada workspace
npm test             # tests unitarios de motores y apps
npm run licenses     # licencias de dependencias dentro de la lista permitida
```

La estructura del repositorio, los paquetes de motores y las convenciones de
código están en [CONTRIBUTING.md](CONTRIBUTING.md).

## Fork y licencias

duo180 Office es un **fork de [GenOffice](https://github.com/genspark-ai/genoffice)**,
el proyecto original de código abierto sobre el que se apoya. Este fork toma
sus motores de documentos y trabaja en una versión más sencilla, sin la capa de
IA.

- Proyecto original: <https://github.com/genspark-ai/genoffice>
- Web original: <https://genoffice.ai/>
- Licencia de este repositorio: [Apache License 2.0](LICENSE)
- Avisos de terceros y atribución: [NOTICE](NOTICE)

Ambos proyectos se distribuyen bajo Apache-2.0, así que el código y la licencia
originales se conservan.
