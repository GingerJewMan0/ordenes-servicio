import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import { EMPRESAS } from './api';

const escapar = (valor) => String(valor ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const rellenar = (valor) => String(valor ?? '').trim() || '—';
const dinero = (valor) => `$${(Number(valor) || 0).toFixed(2)} MXN`;

const GASTOS = [
  ['Casetas', 'casetas'],
  ['Estacionamiento', 'estacionamiento'],
  ['Gasolina', 'gasolina'],
  ['Hospedaje', 'hospedaje'],
  ['Comida', 'comida'],
  ['Refacciones', 'refacciones'],
  ['Material', 'material'],
  ['Otros', 'otros']
];

async function logoComoBase64(logo) {
  if (!logo) return '';
  try {
    let uri = '';
    if (typeof logo === 'number') {
      const asset = Asset.fromModule(logo);
      await asset.downloadAsync();
      uri = asset.localUri || asset.uri;
    } else if (typeof logo === 'string') {
      uri = logo;
    }
    if (!uri || !uri.startsWith('file://')) return '';
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const tipo = /\.jpe?g(?:$|\?)/i.test(uri) ? 'jpeg' : 'png';
    return `data:image/${tipo};base64,${base64}`;
  } catch (error) {
    console.warn('No se pudo insertar el logo en el PDF:', error.message);
    return '';
  }
}

export async function generarPdfViaticos(solicitud) {
  const empresa = EMPRESAS.find((e) => e.id === solicitud.empresaId) || EMPRESAS[0];
  const datosEmpresa = empresa?.contacto || {};
  const logo = await logoComoBase64(empresa?.logo);
  // Los viáticos anteriores conservan las categorías originales; no se redistribuyen importes.
  const contieneGastosAntiguos = Object.prototype.hasOwnProperty.call(solicitud.gastos || {}, 'transporte') ||
    Object.prototype.hasOwnProperty.call(solicitud.gastos || {}, 'alimentacion');
  const gastosMostrar = contieneGastosAntiguos
    ? [['Transporte / gasolina (histórico)', 'transporte'], ['Alimentación (histórico)', 'alimentacion'],
        ['Hospedaje', 'hospedaje'], ['Casetas', 'casetas'], ['Otros gastos', 'otros']]
    : GASTOS;
  const tablaGastos = gastosMostrar.map(([nombre, campo]) => `
    <tr><td>${escapar(nombre)}</td><td class="importe">${escapar(dinero(solicitud.gastos?.[campo]))}</td></tr>
  `).join('');
  // El PDF se diseña como una sola hoja tamaño carta. Para evitar cortar texto,
  // se avisa si los campos de texto libre son excesivamente largos.
  const observaciones = String(solicitud.observaciones ?? '');
  const motivo = String(solicitud.motivo ?? '');
  const lineasEstimadas = (valor, ancho) => valor.split(/\r?\n/).reduce((total, linea) => total + Math.max(1, Math.ceil(linea.length / ancho)), 0);
  if (observaciones.length > 400 || motivo.length > 400 ||
      (observaciones.length + motivo.length) > 560 ||
      lineasEstimadas(observaciones, 85) + lineasEstimadas(motivo, 55) > 9) {
    throw new Error(
      'El texto de Motivo de la comisión y Observaciones es demasiado largo para una sola hoja. Redúcelo para evitar que se corte información.'
    );
  }

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8" />
  <style>
    /* Una hoja carta real, sin encabezados de navegador ni márgenes automáticos. */
    @page { size: letter; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 9pt; }
    .hoja {
      width: 100%; height: 278mm; position: relative;
      padding: 9mm 12mm 26mm;
      display: flex; flex-direction: column;
      page-break-after: avoid; break-after: avoid;
    }
    .contenido { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .encabezado {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; border-bottom: 2px solid #1d6094;
      padding-bottom: 7px; min-height: 35px;
    }
    .logo { max-width: 140px; max-height: 47px; object-fit: contain; }
    .empresa { font-size: 12pt; font-weight: 700; color: #12476f; }
    .folio { white-space: nowrap; font-size: 9pt; }
    h1 { color: #12476f; font-size: 14pt; margin: 9px 0 6px; }
    h2 { color: #12476f; font-size: 10.5pt; border-bottom: 1px solid #cbd5e1;
      padding-bottom: 3px; margin: 7px 0 4px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 3.5px 6px;
      text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #edf4fa; color: #194b73; }
    .campo { font-weight: 700; width: 28%; }
    .importe { text-align: right; white-space: nowrap; }
    .total td { background: #e8f3fb; font-weight: 700; font-size: 10pt; }
    .nota { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.3; }
    .firmas { position: absolute; left: 12mm; right: 12mm; bottom: 37mm;
      display: flex; gap: 28px; page-break-inside: avoid; }
    .firma { flex: 1; text-align: center; border-top: 1px solid #475569;
      padding-top: 5px; font-size: 8.5pt; }
    .pie-empresa {
      position: absolute; left: 12mm; right: 12mm; bottom: 11mm;
      border-top: 2px solid #1d6094;
      padding-top: 7px; font-size: 8pt; line-height: 1.35;
      color: #334155; overflow-wrap: anywhere;
      page-break-inside: avoid;
    }
    .pie-empresa p { margin: 2px 0; }
  </style></head><body>
  <div class="hoja">
    <main class="contenido">
      <div class="encabezado">
        <div>${logo ? `<img class="logo" src="${logo}" />` : `<div class="empresa">${escapar(empresa?.nombre || '')}</div>`}</div>
        <div class="folio"><strong>Folio:</strong> ${escapar(rellenar(solicitud.folio))}</div>
      </div>
      <h1>Solicitud de viáticos</h1>
      <h2>Información de la comisión</h2>
      <table>
        <tr><td class="campo">Empresa</td><td>${escapar(empresa?.nombre || '')}</td></tr>
        <tr><td class="campo">Solicitante</td><td>${escapar(rellenar(solicitud.empleado))}</td></tr>
        <tr><td class="campo">Destino</td><td>${escapar(rellenar(solicitud.destino))}</td></tr>
        <tr><td class="campo">Fecha de salida</td><td>${escapar(rellenar(solicitud.fechaInicio))}</td></tr>
        <tr><td class="campo">Fecha de regreso</td><td>${escapar(rellenar(solicitud.fechaFin))}</td></tr>
        <tr><td class="campo">Folio de orden relacionado</td><td>${escapar(rellenar(solicitud.ordenRelacionada))}</td></tr>
        <tr><td class="campo">Motivo de la comisión</td><td class="nota">${escapar(rellenar(solicitud.motivo))}</td></tr>
      </table>
      <h2>Presupuesto de gastos</h2>
      <table><thead><tr><th>Concepto</th><th class="importe">Importe</th></tr></thead>
        <tbody>${tablaGastos}<tr class="total"><td>Total solicitado</td><td class="importe">${escapar(dinero(solicitud.total))}</td></tr></tbody>
      </table>
      <h2>Observaciones</h2>
      <div class="nota">${escapar(rellenar(solicitud.observaciones))}</div>
      <div class="firmas"><div class="firma">Firma de quien solicita</div><div class="firma">Firma de autorización</div></div>
    </main>
    <footer class="pie-empresa">
      <strong>${escapar(empresa?.nombre || '')}</strong>
      <p>Dirección: ${escapar(rellenar(datosEmpresa.direccion))}</p>
      <p>Teléfono: ${escapar(rellenar(datosEmpresa.telefono))} &nbsp; | &nbsp; Email: ${escapar(rellenar(datosEmpresa.email))}</p>
    </footer>
  </div>
  </body></html>`;

  const resultado = await Print.printToFileAsync({ html, width: 612, height: 792 });
  if (!resultado?.uri) throw new Error('No se pudo generar el archivo PDF.');
  const carpeta = `${FileSystem.documentDirectory}viaticos/`;
  await FileSystem.makeDirectoryAsync(carpeta, { intermediates: true });
  const folio = String(solicitud.folio || 'sin-folio').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 45);
  const destino = `${carpeta}viaticos-${folio}-${Date.now()}.pdf`;
  await FileSystem.copyAsync({ from: resultado.uri, to: destino });
  return destino;
}

export async function compartirPdfViaticos(uri) {
  if (!await Sharing.isAvailableAsync()) {
    throw new Error('El PDF se guardó, pero no está disponible el menú para compartir en este dispositivo.');
  }
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Compartir solicitud de viáticos' });
}
