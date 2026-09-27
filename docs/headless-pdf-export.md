# Exportación a PDF sin interfaz (headless)

Toda ruta de "exportar a PDF" de la suite se puede ejecutar sin una ventana de
editor visible, a través de un único punto de entrada:

```
<binario de la app> --headless-export <archivo-de-entrada> --to pdf --out <ruta> [--json]
```

La aplicación no crea ninguna ventana visible, oculta el icono del dock en
macOS, escribe exactamente una línea en stdout y termina. **No** toma el bloqueo
de instancia única, así que convive sin problema con una instancia con interfaz.

```
$ duo180 Office --headless-export informe.docx --to pdf --out informe.pdf --json
{"status":"ok","summary":"Exported /w/informe.docx to /w/informe.pdf","output_path":"/w/informe.pdf"}
```

Sin `--json` esa misma línea es una frase normal. Se aceptan tanto
`--flag valor` como `--flag=valor`.

## Códigos de salida

| código | significado                                                                          |
| ------ | ------------------------------------------------------------------------------------ |
| 0      | el PDF se ha escrito                                                                  |
| 1      | argumentos incorrectos (falta `--out`, destino distinto de `pdf`, sin carpeta de salida) |
| 2      | problema con el archivo de entrada (no existe, no es un archivo, extensión que ningún módulo puede renderizar) |
| 3      | fallo de conversión (documento ilegible, caída del renderer, tiempo de espera agotado) |

En caso de fallo, el sobre JSON es
`{"status":"error","summary":…,"error":…}`, en una sola línea y con los saltos
de línea convertidos en espacios.

## Entradas admitidas

| extensión                     | módulo   |
| ----------------------------- | -------- |
| `.docx`                       | docs     |
| `.xlsx` `.xlsm` `.xls` `.csv` | sheets   |
| `.pptx`                       | slides   |
| `.md` `.markdown`             | markdown |
| `.html` `.htm`                | html     |

## Cómo funciona

La gramática, los códigos de salida y los ayudantes de espera del lado del
renderer viven en `packages/electron-utils/src/headless-export.ts`; la mitad del
renderer se importa por el subcamino `@genoffice/electron-utils/headless-export`
para que un bundle de renderer nunca arrastre los builtins de `node:`.

`apps/shell/src/main/headless-export.ts` valida las rutas y enruta por extensión
a un exportador de ventana oculta por módulo
(`exportDocsPdfHeadless`, `exportSheetsPdfHeadless`, …). Cada exportador:

1. crea una `BrowserWindow` con `show: false`, el preload normal de ese módulo,
   sandbox y `backgroundThrottling: false`;
2. encola la entrada por la ruta de "apertura pendiente" que ya existe en el
   módulo, para que el renderer ejecute su proceso de carga habitual;
3. deja que el renderer espere a que el documento se asiente (docs: el número
   de segmentos de paginación estable dos veces seguidas; slides: cada imagen
   decodificada y las fuentes privadas de Office registradas; sheets: el libro
   totalmente precargado) y llame después a **la misma función de exportación
   que llama el menú Archivo**, con la ruta de la CLI en lugar del diálogo de
   guardado;
4. resuelve con el informe del renderer y destruye la ventana.

Hay una única función de exportación por módulo —la interfaz no pasa ruta y
recibe un diálogo, la versión headless pasa una y no lo recibe—, así que la
salida de la interfaz y la de la CLI no pueden divergir. Medido sobre cuatro
documentos, ambas rutas producen PDF que solo difieren en la marca de tiempo de
creación incrustada.

`isHeadlessMode()` (`packages/electron-utils/src/headless-mode.ts`) se activa
antes de que arranque cualquier módulo de edición; silencia todo lo que
aparecería en pantalla tras una escritura correcta (abrir la exportación en una
pestaña, mostrarla en el gestor de archivos) y la entrada de archivos recientes
de slides.

## Comportamiento que conviene conocer

- **Una entrada ilegible es un error, no una página en blanco.** docs y slides
  responden a un archivo corrupto con un documento en blanco sin título; la
  versión headless trata "hay un documento montado pero no vino del disco" como
  código de salida 3.
- **Los documentos protegidos con contraseña** no se pueden resolver sin una
  persona, así que fallan por tiempo de espera de preparación en lugar de
  fallar de inmediato.
- **Los libros grandes** normalmente esperan a que el usuario pulse "Carga
  completa" antes de permitir la exportación a PDF. La versión headless toma
  esa decisión por sí misma.
- **Solo se exporta la hoja activa** en las hojas de cálculo, exactamente igual
  que en la interfaz.
