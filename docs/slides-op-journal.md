# Slides: diario de operaciones (base para colaboración)

> Nota: documento de diseño heredado del proyecto original. Algunas de las
> fuentes de operaciones ligadas a la IA (por ejemplo las herramientas de
> edición por modelo o `generate_deck`) están desapareciendo en este fork, así
> que los nombres de origen pueden quedar obsoletos.

Estado: la base está puesta; todavía no hay transporte de red. El intercambio
dentro del mismo proceso funciona: dos webContents asociados a una misma
`Session` (`slides:open-path` sobre un archivo ya abierto, público de
presentador) reciben avisos `slides:deck-changed` mediante
`scheduleDeckBroadcast` — el primer consumidor del bucle "uno edita, el otro lo
ve". Llegar a él desde la interfaz del contenedor necesita una segunda ventana
o una vista dividida, que el contenedor aún no tiene (enfoca la pestaña
existente).

## Qué existe

Toda mutación de documento en Slides pasa por el ejecutor de operaciones
(`runTxn`), y cada transacción **aplicada** se añade ahora a un diario por
sesión (`Session.opLog` en `apps/slides/src/main/session-state.ts`):

```ts
interface OpLogEntry {
  seq: number // monótono por sesión
  source: 'edit' | 'batch' | 'script' | 'generate' | 'reset'
  ops: Array<{ op: Op; slideId?: string; created?: string[] }>
}
```

- `edit` — adaptadores de la interfaz y herramientas dedicadas de IA (texto,
  rellenos, transformaciones, tablas, edición de patrones, …)
- `batch` — `apply_ops` (`slides:apply-txn`)
- `script` — `execute_slide_script` (`slides:apply-edit-script`)
- `generate` — aterrizaje de páginas generadas (`slides:land-generated-pages`),
  que ahora inserta páginas como operaciones `insertSlidePptx` en lugar de
  mutar la presentación directamente
- `reset` — se ha restaurado una instantánea (deshacer/rehacer/reversión de
  IA); el diario no puede expresarlo como operaciones, así que los consumidores
  deben resincronizar por completo después de él

`slideId` es el identificador duradero que el ejecutor estampa en el momento de
aplicar; `created` lleva los identificadores creados por operaciones aditivas.
Las cargas (por ejemplo bytes de imágenes, fuentes de página extraídas) se
conservan tal cual; el anillo está limitado a 200 entradas.

El embudo único es `journaledTxn` en `slides-main.ts`: toda llamada `runTxn` no
seca del módulo pasa por él. No añadas llamadas directas a `runTxn` en los
manejadores de IPC.

## Lo que aún necesita un transporte (fase 2)

1. **Autoridad de ordenación.** El diario es por proceso principal. Varias
   personas necesitan un servidor que ordene las operaciones y las reparta; los
   clientes aplican las entradas remotas por el mismo ejecutor.
2. **Recursos direccionados por contenido.** Las cargas de `addPicture` /
   `insertSlidePptx` llevan los bytes en línea; un transporte debería
   sustituirlos por hashes de contenido más un canal de subida.
3. **Operaciones inversas para deshacer.** Hoy deshacer se basa en instantáneas,
   y por eso las restauraciones se registran como `reset`. `OpRecord.before` ya
   se captura; derivar operaciones inversas elimina la mayoría de las marcas
   `reset`.
4. **El estado derivado se queda en local.** El reajuste automático de tamaño y
   de escala de fuente tras las operaciones de texto son rederivaciones
   deterministas que hace la pasada posterior de cada cliente; son mutaciones de
   la presentación pero no se registran como operaciones — un par remoto las
   rederiva repitiendo la operación de texto por el mismo camino.
5. **Sustitución de toda la presentación.** `generate_deck` en modo `replace`
   construye una sesión nueva (identidad de documento nueva); el diario
   empieza de cero. Un transporte debería tratarlo como "abrir otro documento".
