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
  ['Transporte / gasolina', 'transporte'],
  ['Alimentación', 'alimentacion'],
  ['Hospedaje', 'hospedaje'],
  ['Casetas', 'casetas'],
  ['Otros gastos', 'otros']
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
  const tablaGastos = GASTOS.map(([nombre, campo]) => `
    <tr><td>${escapar(nombre)}</td><td class="importe">${escapar(dinero(solicitud.gastos?.[campo]))}</td></tr>
  `).join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 17mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 11pt; margin: 0; }
    .encabezado { display: flex; align-items: center; justify-content: space-between; gap: 15px; border-bottom: 3px solid #1d6094; padding-bottom: 13px; }
    .logo { max-width: 165px; max-height: 73px; object-fit: contain; }
    .empresa { font-size: 15pt; font-weight: 700; color: #12476f; }
    h1 { color: #12476f; font-size: 20pt; margin: 24px 0 18px; }
    h2 { color: #12476f; font-size: 13pt; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; margin: 23px 0 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 9px 8px; text-align: left; vertical-align: top; }
    th { background: #edf4fa; color: #194b73; }
    .campo { font-weight: 700; width: 28%; }
    .importe { text-align: right; white-space: nowrap; }
    .total td { background: #e8f3fb; font-weight: 700; font-size: 13pt; }
    .nota { white-space: pre-wrap; word-break: break-word; }
    .firmas { display: flex; gap: 38px; margin-top: 65px; page-break-inside: avoid; }
    .firma { flex: 1; text-align: center; border-top: 1px solid #475569; padding-top: 8px; font-size: 10pt; }
    footer { border-top: 2px solid #1d6094; margin-top: 45px; padding-top: 13px; font-size: 9pt; color: #334155; page-break-inside: avoid; }
    footer p { margin: 3px 0; }
  </style></head><body>
  <div class="encabezado">
    <div>${logo ? `<img class="logo" src="${logo}" />` : `<div class="empresa">${escapar(empresa?.nombre || '')}</div>`}</div>
    <div style="text-align:right"><strong>Folio:</strong> ${escapar(solicitud.folio)}</div>
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
  <footer>
    <strong>${escapar(empresa?.nombre || '')}</strong>
    <p>Dirección: ${escapar(rellenar(datosEmpresa.direccion))}</p>
    <p>Teléfono: ${escapar(rellenar(datosEmpresa.telefono))} &nbsp; | &nbsp; Email: ${escapar(rellenar(datosEmpresa.email))}</p>
  </footer>
  </body></html>`;

  const resultado = await Print.printToFileAsync({ html });
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
