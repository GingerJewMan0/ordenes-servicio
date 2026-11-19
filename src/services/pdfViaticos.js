import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

// Comprobación general: sin logos, razón social, domicilio, membretes ni firmas.
const RUBROS = [
  ['Casetas', 'casetas'], ['Estacionamiento', 'estacionamiento'],
  ['Gasolina', 'gasolina'], ['Hospedaje', 'hospedaje'],
  ['Comida', 'comida'], ['Refacciones', 'refacciones'],
  ['Material', 'material'], ['Otros', 'otros'],
];
const htmlSeguro = (v) => String(v ?? '').replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const texto = (v) => String(v ?? '').trim() || '—';
const centavos = (v) => Math.round((Number(v) || 0) * 100);
const pesos = (c) => '$' + (c / 100).toFixed(2);
const fechaMas = (inicio, n) => {
  const d = new Date(`${inicio}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error('Fecha de inicio inválida.');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const header = (folio) => `<div class="encabezado"><h1>COMPROBACIÓN DE VIÁTICOS</h1><div class="folio">Folio: ${htmlSeguro(texto(folio))}</div></div>`;

const CONCEPTOS_FOTO = Object.fromEntries(RUBROS.map(([nombre, clave]) => [clave, nombre]));
const FOTOS_POR_PAGINA = 2; // Dos comprobantes grandes para que los tickets sean legibles.

// El HTML usa base64 porque las URL file:// no siempre son accesibles al
// motor de impresión de Android (expo-print).
async function prepararComprobantesParaPdf(comprobantes) {
  if (!Array.isArray(comprobantes) || !comprobantes.length) return [];
  // Android puede quedarse sin memoria si imprime decenas de fotos sin reducir.
  // La reducción SOLO se usa en el PDF; los originales en el teléfono no cambian.
  const muchasFotos = comprobantes.length > 16;
  const ancho = muchasFotos ? 1000 : 1400;
  const compresion = muchasFotos ? 0.55 : 0.70;
  const lista = [];
  for (let i = 0; i < comprobantes.length; i++) {
    const foto = comprobantes[i];
    const uri = String(foto?.uri || '');
    if (!uri.startsWith('file://')) {
      throw new Error(`La foto ${i + 1} no tiene un archivo local válido. Puedes generar "PDF resumen" sin fotografías mientras la revisas.`);
    }
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      throw new Error(`No se encuentra la foto ${i + 1}. Los originales no se han eliminado. Puedes generar "PDF resumen" desde el historial.`);
    }
    try {
      const reducida = await manipulateAsync(
        uri,
        [{ resize: { width: ancho } }],
        { compress: compresion, format: SaveFormat.JPEG, base64: true }
      );
      if (!reducida?.base64 || !reducida.base64.startsWith('/9j/')) {
        throw new Error('La conversión no devolvió una imagen JPEG válida.');
      }
      lista.push({ ...foto, dataUri: `data:image/jpeg;base64,${reducida.base64}` });
    } catch (e) {
      throw new Error(`No se pudo preparar el comprobante ${i + 1} para el PDF: ${e.message}. Intenta "PDF resumen" para comprobar que los datos sí aparecen.`);
    }
  }
  return lista;
}

const estilosAnexo = `
  .anexo-pagina { width:279.4mm; height:215.9mm; padding:9mm 11mm 10mm;
    overflow:hidden; page-break-after:always; break-after:page; }
  .anexo-pagina:last-child { page-break-after:auto; break-after:auto; }
  .anexo-cabecera { display:flex; align-items:baseline; justify-content:space-between;
    border-bottom:1.2px solid #64748b; padding-bottom:7px; margin-bottom:8px; }
  .anexo-cabecera h2 { font-size:14pt; font-weight:700; margin:0; color:#26364c; }
  .anexo-folio { font-size:9pt; font-weight:700; }
  .anexo-subtitulo { font-size:8.6pt; color:#536275; margin:0 0 9px; }
  .anexo-grilla { display:block; width:100%; height:168mm; }
  .anexo-foto { float:left; width:49%; height:100%; border:1px solid #cbd5e1;
    border-radius:4px; padding:6px; display:block; margin:0; }
  .anexo-foto + .anexo-foto { float:right; }
  .anexo-foto figcaption { font-size:9pt; line-height:1.35; padding:2px 2px 7px;
    border-bottom:1px solid #e2e8f0; margin-bottom:6px; }
  .anexo-imagen { width:100%; height:145mm; background-position:center; background-size:contain; background-repeat:no-repeat; }
`;

function construirPaginasAnexo(solicitud) {
  const fotos = (solicitud.comprobantes || []).filter(f => f?.dataUri);
  if (!fotos.length) return '';
  const paginas = [];
  for (let i = 0; i < fotos.length; i += FOTOS_POR_PAGINA) {
    const grupo = fotos.slice(i, i + FOTOS_POR_PAGINA);
    const tarjetas = grupo.map((foto, pos) => {
      const indice = i + pos + 1;
      const tipo = CONCEPTOS_FOTO[foto.concepto] || foto.concepto || 'Comprobante';
      if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(foto.dataUri)) {
        throw new Error(`Los datos de la fotografía ${indice} no son válidos.`);
      }
      return `<figure class="anexo-foto"><figcaption><strong>Comprobante ${indice}</strong><br>
        Fecha: ${htmlSeguro(texto(foto.fecha))} · Concepto: ${htmlSeguro(tipo)}</figcaption>
        <div class="anexo-imagen" style="background-image:url('${foto.dataUri}')" aria-label="Comprobante ${indice}"></div></figure>`;
    }).join('');
    paginas.push(`<section class="anexo-pagina">
      <div class="anexo-cabecera"><h2>ANEXO · COMPROBANTES FOTOGRÁFICOS</h2>
      <span class="anexo-folio">Folio: ${htmlSeguro(texto(solicitud.folio))}</span></div>
      <p class="anexo-subtitulo">Comprobantes ${i+1} a ${i+grupo.length} de ${fotos.length}. Imágenes conservadas en el dispositivo de origen.</p>
      <div class="anexo-grilla">${tarjetas}</div></section>`);
  }
  return paginas.join('');
}


// Se exporta para revisar la presentación sin depender del teléfono.
export function construirHtmlViaticosSemanal(solicitud) {
  const fechas = Array.from({ length: 7 }, (_, i) => fechaMas(solicitud.fechaInicio, i));
  const dias = new Map((solicitud.dias || []).map(d => [String(d.fecha).slice(0,10), d]));
  const nombres = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const hayDias = fechas.some(f => dias.has(f));
  if (!hayDias) throw new Error('Este registro no contiene días para el reporte semanal.');
  const visitas = ['hospitales', 'proyecto'];
  const largoMax = fechas.reduce((m, f) => Math.max(m, ...visitas.map(k => String(dias.get(f)?.[k] || '').length)), 0);
  const largoTotal = fechas.reduce((s, f) => s + visitas.reduce((t, k) => t + String(dias.get(f)?.[k] || '').length, 0), 0);
  if (largoMax > 125 || largoTotal > 950) {
    throw new Error('El texto de hospitales/proyectos es demasiado largo para una sola hoja. Resume las visitas de cada día antes de compartir el PDF.');
  }
  const totalRubro = (r) => fechas.reduce((s,f)=>s+(dias.has(f)?centavos(dias.get(f)?.gastos?.[r]):0),0);
  const totalDia = f => dias.has(f) ? RUBROS.reduce((s,[,r])=>s+centavos(dias.get(f)?.gastos?.[r]),0) : null;
  const sumaTotal = RUBROS.reduce((s,[,r]) => s + totalRubro(r), 0);
  const filasGastos = RUBROS.map(([nombre,r]) => `<tr>
      <td class="etiqueta">${htmlSeguro(nombre)}</td>
      ${fechas.map(f=>`<td class="importe">${!dias.has(f) ? '—' : (centavos(dias.get(f)?.gastos?.[r]) ? pesos(centavos(dias.get(f)?.gastos?.[r])) : '—')}</td>`).join('')}
      <td class="importe total-col">${pesos(totalRubro(r))}</td>
    </tr>`).join('');
  const filaTotal = `<tr class="totales"><td>Total diario</td>${fechas.map(f=>`<td class="importe">${totalDia(f) === null ? '—' : pesos(totalDia(f))}</td>`).join('')}<td class="importe">${pesos(sumaTotal)}</td></tr>`;
  const cuadriculaVisitas = ['hospitales', 'proyecto'].map((clave, i) => `<tr><th scope="row">${i === 0 ? 'Hospitales visitados' : 'Proyecto'}</th>${fechas.map(f=>`<td>${dias.has(f) ? htmlSeguro(texto(dias.get(f)?.[clave])) : '—'}</td>`).join('')}</tr>`).join('');
  const nFotos = Array.isArray(solicitud.comprobantes) ? solicitud.comprobantes.length : 0;
  const paginasAnexo = construirPaginasAnexo(solicitud);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @page { size: letter landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #273142; }
    .hoja { width: 279.4mm; height: 215.9mm; padding: 9mm 11mm 10mm; overflow: hidden; }
    .encabezado { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1.2px solid #64748b; padding-bottom: 7px; }
    h1 { font-size: 14pt; font-weight: 700; letter-spacing: .25px; color:#26364c; margin: 0; }
    .folio { font-weight: 700; font-size: 10pt; white-space: nowrap; }
    h2 { font-size: 9.5pt; margin: 9px 0 4px; color: #33465e; }
    .metas { display:grid; grid-template-columns: 1fr 1fr; gap: 3px 14px; margin: 8px 0; font-size: 8.1pt; }
    .metas div { border-bottom: 1px solid #e0e6ed; padding: 3px 2px; overflow-wrap:anywhere; }
    .metas strong { color: #3d4c5f; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    .gastos { font-size: 7.9pt; }
    .gastos th, .gastos td { border: 1px solid #cfd8e1; padding: 4px 4px; }
    .gastos thead th { background: #eaf0f5; color:#263a53; font-weight:700; text-align:center; }
    .gastos .etiqueta { font-weight: 600; }
    .importe { white-space:nowrap; text-align:right; }
    .gastos .total-col { background:#f2f5f8; font-weight:700; }
    .gastos .totales > * { background:#e2ebf2; font-weight:700; }
    .visitas { font-size:7.4pt; }
    .visitas th, .visitas td { border:1px solid #b7c5d3; padding:5px 5px; vertical-align:top; overflow-wrap:anywhere; word-break:normal; }
    .visitas thead th { background:#eaf0f5; text-align:center; font-size:7.4pt; color:#263a53; }
    .visitas thead th:first-child { text-align:left; }
    .visitas tbody th { text-align:left; font-weight:700; background:#f3f6f9; }
    .visitas tbody td { line-height:1.25; white-space:pre-line; }
    .observacion { padding:7px 8px; border:1px solid #dce3eb; font-size:8pt; line-height:1.25; white-space:pre-wrap; overflow-wrap:anywhere; min-height:27px; }
    .fotos { font-size:7.6pt; margin-top:8px; color:#5b6471; }
    ${nFotos ? '.hoja { page-break-after:always; break-after:page; }' : ''}
    ${estilosAnexo}
  </style></head><body><main class="hoja">
    ${header(solicitud.folio)}
    <section class="metas">
      <div><strong>Empleado / técnico:</strong> ${htmlSeguro(texto(solicitud.empleado))}</div>
      <div><strong>Semana:</strong> ${htmlSeguro(fechas[0])} al ${htmlSeguro(fechas[6])}</div>
      <div><strong>Destino general:</strong> ${htmlSeguro(texto(solicitud.destino))}</div>
      <div><strong>Orden relacionada:</strong> ${htmlSeguro(texto(solicitud.ordenRelacionada))}</div>
      <div style="grid-column:1 / 3"><strong>Motivo:</strong> ${htmlSeguro(texto(solicitud.motivo))}</div>
    </section>
    <h2>Gastos comprobados por día · MXN</h2>
    <table class="gastos"><colgroup><col style="width:19%">${fechas.map(()=>'<col style="width:9.3%">').join('')}<col style="width:15.9%"></colgroup>
      <thead><tr><th>Concepto</th>${fechas.map((f,i)=>`<th>${nombres[i]}<div>${f.slice(8)}/${f.slice(5,7)}</div></th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${filasGastos}${filaTotal}</tbody>
    </table>
    <h2>Hospitales y proyectos realizados por día</h2>
    <table class="visitas"><colgroup><col style="width:19%">${fechas.map(()=>'<col style="width:11.57%">').join('')}</colgroup>
      <thead><tr><th>Día</th>${fechas.map((f,i)=>`<th>${nombres[i]}<div>${f.slice(8)}/${f.slice(5,7)}</div></th>`).join('')}</tr></thead>
      <tbody>${cuadriculaVisitas}</tbody>
    </table>
    <h2>Observaciones</h2><div class="observacion">${htmlSeguro(texto(solicitud.observaciones))}</div>
    <div class="fotos">${nFotos ? `Se adjuntan ${nFotos} comprobante(s) fotográfico(s) en las páginas siguientes.` : 'No se adjuntaron comprobantes fotográficos.'}</div>
  </main>${paginasAnexo}</body></html>`;
}

export function construirHtmlViaticosHistorico(solicitud) {
  const gastos = solicitud.gastos || {};
  const esHistorico = Object.prototype.hasOwnProperty.call(gastos, 'transporte') || Object.prototype.hasOwnProperty.call(gastos, 'alimentacion');
  const rubros = esHistorico
    ? [['Transporte / gasolina (histórico)','transporte'],['Alimentación (histórico)','alimentacion'], ['Hospedaje','hospedaje'], ['Casetas','casetas'], ['Otros','otros']]
    : RUBROS;
  const filas = rubros.map(([nombre,clave])=>`<tr><td>${htmlSeguro(nombre)}</td><td style="text-align:right">${pesos(centavos(gastos[clave]))} MXN</td></tr>`).join('');
  const total = rubros.reduce((s,[,clave])=>s+centavos(gastos[clave]),0);
  const nFotos = Array.isArray(solicitud.comprobantes) ? solicitud.comprobantes.length : 0;
  const paginasAnexo = construirPaginasAnexo(solicitud);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @page{size:letter;margin:0}*{box-sizing:border-box}
    body{font:10pt Arial,Helvetica,sans-serif;color:#273142;margin:0}
    main{width:215.9mm;height:279.4mm;padding:15mm 18mm;overflow:hidden}
    h1{font-size:16pt;margin:0 0 12px;border-bottom:1px solid #64748b;padding-bottom:8px}
    h2{font-size:11pt;margin:16px 0 7px;color:#33465e}
    .folio{float:right;font-size:10pt}
    table{width:100%;border-collapse:collapse} td,th{border-bottom:1px solid #dce3eb;padding:7px;text-align:left}
    th{background:#f0f4f7} .total{font-weight:700;background:#eaf0f5}
    .nota{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.35}
    ${nFotos ? 'main { page-break-after:always; break-after:page; }' : ''}
    ${estilosAnexo}
  </style></head><body><main>
    <div class="folio">Folio: <strong>${htmlSeguro(texto(solicitud.folio))}</strong></div>
    <h1>COMPROBACIÓN DE VIÁTICOS</h1>
    <table><tr><td>Empleado / técnico</td><td>${htmlSeguro(texto(solicitud.empleado))}</td></tr>
    <tr><td>Destino</td><td>${htmlSeguro(texto(solicitud.destino))}</td></tr>
    <tr><td>Fechas</td><td>${htmlSeguro(texto(solicitud.fechaInicio))} al ${htmlSeguro(texto(solicitud.fechaFin))}</td></tr>
    <tr><td>Orden relacionada</td><td>${htmlSeguro(texto(solicitud.ordenRelacionada))}</td></tr>
    <tr><td>Motivo</td><td class="nota">${htmlSeguro(texto(solicitud.motivo))}</td></tr></table>
    <h2>Gastos comprobados</h2><table><thead><tr><th>Concepto</th><th style="text-align:right">Importe</th></tr></thead>
    <tbody>${filas}<tr class="total"><td>Total comprobado</td><td style="text-align:right">${pesos(total)} MXN</td></tr></tbody></table>
    <h2>Observaciones</h2><p class="nota">${htmlSeguro(texto(solicitud.observaciones))}</p>
    <p>${nFotos ? `Se adjuntan ${nFotos} comprobante(s) fotográfico(s) en las páginas siguientes.` : 'No se adjuntaron comprobantes fotográficos.'}</p>
  </main>${paginasAnexo}</body></html>`;
}

export async function generarPdfViaticos(solicitud, opciones = {}) {
  const semanal = Array.isArray(solicitud?.dias) && solicitud.dias.length > 0;
  // Los comprobantes siguen en almacenamiento local, solo se convierten a
  // base64 para imprimirlos como anexo del mismo PDF. No se envían a Render.
  const originales = opciones.incluirComprobantes === false ? [] : solicitud?.comprobantes;
  const fotos = await prepararComprobantesParaPdf(originales);
  const datosPdf = {...solicitud, comprobantes: fotos};
  const html = semanal ? construirHtmlViaticosSemanal(datosPdf) : construirHtmlViaticosHistorico(datosPdf);
  const resultado = await Print.printToFileAsync({html, ...(semanal ? {width:792,height:612} : {width:612,height:792})});
  if (!resultado?.uri) throw new Error('No se pudo generar el PDF.');
  const carpeta = `${FileSystem.documentDirectory}viaticos/`;
  await FileSystem.makeDirectoryAsync(carpeta, {intermediates:true});
  const nombre = String(solicitud?.folio || 'pendiente').replace(/[^a-zA-Z0-9_-]/g, '-');
  const destino = `${carpeta}comprobacion-viaticos-${nombre}-${Date.now()}.pdf`;
  await FileSystem.copyAsync({from:resultado.uri,to:destino});
  const infoPdf = await FileSystem.getInfoAsync(destino);
  if (!infoPdf.exists || !infoPdf.size || infoPdf.size < 3000) {
    throw new Error("El generador no produjo un PDF válido. Prueba PDF resumen y revisa los comprobantes.");
  }
  return destino;
}
export async function compartirPdfViaticos(uri) {
  if (!await Sharing.isAvailableAsync()) throw new Error('No se puede compartir el PDF en este teléfono.');
  await Sharing.shareAsync(uri, {mimeType:'application/pdf', dialogTitle:'Compartir comprobación de viáticos'});
}
