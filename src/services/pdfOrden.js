import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import { Image } from 'react-native';
import { LOGOS_PDF } from './logosPdfBase64';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  cargarContactoEmpresa, cargarLogo, nombreEmpresa
} from './ordenesLocales';

const escapar = (valor) => String(valor ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const texto = (valor, fallback = '—') => {
  const valorLimpio = String(valor ?? '').trim();
  return valorLimpio ? escapar(valorLimpio) : escapar(fallback);
};
const dato = (titulo, valor) =>
  `<div class="dato"><b>${escapar(titulo)}:</b> ${texto(valor)}</div>`;
const bloque = (titulo, valor, fallback = 'Sin información registrada') =>
  `<section class="bloque"><h2>${escapar(titulo)}</h2><div class="observ">${texto(valor, fallback)}</div></section>`;

// Lee fotos y firmas almacenadas en el teléfono y activos incluidos en el APK.
// En ciertos APK Release, el logo empaquetado no tiene un localUri file:// legible.
// Si ocurre, intentamos copiar el recurso a la caché antes de convertirlo a Base64.
const aDataUri = async (origen) => {
  if (!origen) return null;
  if (typeof origen === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(origen)) {
    return origen;
  }

  let tipoAsset = '';
  let candidatos = [];
  try {
    if (typeof origen === 'number') {
      const asset = Asset.fromModule(origen);
      const preparado = await asset.downloadAsync();
      tipoAsset = preparado.type || asset.type || '';
      const source = Image.resolveAssetSource(origen);
      candidatos = [preparado.localUri, preparado.uri, source?.uri];
    } else if (typeof origen === 'string') {
      candidatos = [origen];
    } else if (typeof origen?.uri === 'string') {
      candidatos = [origen.uri];
    }

    for (const candidato of [...new Set(candidatos.filter(Boolean))]) {
      let ruta = candidato;
      try {
        // La lectura directa es válida para fotos/firmas y recursos extraídos.
        // Algunas rutas internas de Android no son accesibles a getInfoAsync.
        if (!ruta.startsWith('file://') && !ruta.startsWith('content://')) {
          const extension = /jpe?g/i.test(tipoAsset) ? 'jpg' : 'png';
          const temporal = `${FileSystem.cacheDirectory}logo-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
          await FileSystem.copyAsync({ from: ruta, to: temporal });
          ruta = temporal;
        }
        const info = await FileSystem.getInfoAsync(ruta);
        if (!info.exists) continue;
        const b64 = await FileSystem.readAsStringAsync(ruta, {
          encoding: FileSystem.EncodingType.Base64
        });
        if (!b64) continue;
        const esPng = tipoAsset === 'png' || /\.png(?:$|[?#])/i.test(ruta);
        const esWebp = tipoAsset === 'webp' || /\.webp(?:$|[?#])/i.test(ruta);
        const mime = esPng ? 'image/png' : esWebp ? 'image/webp' : 'image/jpeg';
        return `data:${mime};base64,${b64}`;
      } catch (error) {
        console.warn('No se pudo leer un origen de imagen para PDF:', error?.message || error);
      }
    }
  } catch (error) {
    console.warn('No se pudo cargar la imagen para PDF:', error?.message || error);
  }
  return null;
};

const cuadriculaFotos = (titulo, fotos) => `
  <section class="nueva-pagina">
    <h2>${escapar(titulo)}</h2>
    <div class="fotos">${fotos.length ? fotos.map((foto, i) => `
      <div class="foto"><img src="${foto}" /><div>Fotografía ${i + 1}</div></div>
    `).join('') : '<p>No hay fotografías registradas.</p>'}</div>
  </section>`;

const bloqueFirma = (uri, nombre) => uri
  ? `<div class="firma"><img src="${uri}" /><div class="linea"></div><strong>${escapar(nombre || '—')}</strong></div>`
  : `<div class="firma"><div class="sin-firma">Sin firma</div><div class="linea"></div><strong>${escapar(nombre || '—')}</strong></div>`;

export const generarPdfOrden = async (orden) => {
  const form = orden.form || {};
  const fotosAntes = await Promise.all((orden.fotosAntes || []).map(aDataUri));
  const fotosDespues = await Promise.all((orden.fotosDespues || []).map(aDataUri));
  const firmaTecnico = await aDataUri(orden.firmaTecnico);
  const firmaResponsable = await aDataUri(orden.firmaResponsable);

  const uriLogo = orden.logo || (orden.empresaId ? await cargarLogo(orden.empresaId) : null);
  // Preferimos los logos preconvertidos: se generan una vez desde assets/logos/
  // y son fiables incluso cuando Android no expone los recursos del APK como archivos.
  const logo = LOGOS_PDF[orden.empresaId] || await aDataUri(uriLogo);
  const contacto = orden.contactoEmpresa || (orden.empresaId
    ? await cargarContactoEmpresa(orden.empresaId)
    : { direccion: '', telefono: '', email: '' });

  if ((orden.fotosAntes || []).length && fotosAntes.some((uri) => !uri)) {
    throw new Error('Faltan archivos locales de fotografías ANTES. No se generó una copia incompleta.');
  }
  if ((orden.fotosDespues || []).length && fotosDespues.some((uri) => !uri)) {
    throw new Error('Faltan archivos locales de fotografías DESPUÉS. No se generó una copia incompleta.');
  }
  if ((orden.firmaTecnico && !firmaTecnico) || (orden.firmaResponsable && !firmaResponsable)) {
    throw new Error('Faltan archivos locales de firmas. No se generó una copia incompleta.');
  }
  if (uriLogo && !logo) {
    throw new Error('No se pudo leer el logo para el PDF. Ejecuta: node scripts/prepararLogosPdf.cjs (desde la raíz del proyecto), recompila el APK y vuelve a compartir esta misma orden.');
  }

  const empresa = nombreEmpresa(orden.empresaId);
  const fecha = orden.fechaRegistro
    ? new Date(orden.fechaRegistro).toLocaleString('es-MX')
    : form.fecha ? new Date(form.fecha).toLocaleString('es-MX')
    : new Date().toLocaleString('es-MX');
  const marcaModelo = form.marca_modelo || [form.marca, form.modelo].filter(Boolean).join(' / ');
  const recomendaciones = form.recomendaciones ?? form.observaciones_mtto_correctivo;
  const html = `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
  @page { size: A4; margin: 14mm 14mm 29mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color:#172638; font-size:11px; margin:0; }
  header { display:flex; align-items:center; gap:15px; padding-bottom:12px; border-bottom:3px solid #2563a6; }
  header img { width:108px; height:70px; object-fit:contain; }
  h1 { font-size:20px; margin:0; color:#1e4e81; }
  h2 { margin:15px 0 7px; font-size:13px; color:#1e4e81; border-bottom:1px solid #cbd5e1; padding-bottom:4px; }
  .sub { margin-top:6px; color:#485566; }
  .datos { display:grid; grid-template-columns:1fr 1fr; gap:7px 16px; }
  .dato { overflow-wrap:anywhere; }
  .bloque { break-inside:avoid; page-break-inside:avoid; }
  .observ { white-space:pre-wrap; overflow-wrap:anywhere; padding:8px; background:#f1f5f9; border-radius:5px; }
  .firmas { display:flex; gap:24px; margin-top:22px; break-inside:avoid; }
  .firma { flex:1; text-align:center; } .firma img { width:100%; height:88px; object-fit:contain; }
  .linea { height:1px; background:#566; margin:2px 0 7px; }
  .sin-firma { height:88px; display:flex; align-items:end; justify-content:center; }
  .nueva-pagina { page-break-before:always; }
  .fotos { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .foto { border:1px solid #d6e0e8; padding:8px; text-align:center; break-inside:avoid; }
  .foto img { display:block; width:100%; height:205px; object-fit:contain; }
  .foto div { margin-top:5px; font-size:10px; }
  .pie-empresa { position:fixed; bottom:-22mm; left:0; right:0;
    border-top:1px solid #9eb4c9; padding-top:6px; font-size:9px;
    line-height:1.45; color:#40566d; text-align:center; background:white;
    overflow-wrap:anywhere; }
  .pie-empresa strong { color:#1e4e81; }
  </style></head><body>
  <footer class="pie-empresa">
    <strong>${escapar(empresa)}</strong><br/>
    Dirección: ${texto(contacto?.direccion, 'Pendiente de configurar')} &nbsp; | &nbsp;
    Teléfono: ${texto(contacto?.telefono, 'Pendiente de configurar')} &nbsp; | &nbsp;
    Email: ${texto(contacto?.email, 'Pendiente de configurar')}
  </footer>
  <header>${logo ? `<img src="${logo}"/>` : ''}<div><h1>ORDEN DE SERVICIO</h1>
    <div><b>${escapar(empresa)}</b></div><div class="sub">Folio: ${texto(form.folio_orden)} · ${escapar(fecha)}</div></div></header>
  <h2>Datos generales</h2><div class="datos">
    ${dato('No. de folio', form.folio_orden)}${dato('Motivo de la visita', form.motivo_servicio)}
  </div>
  <h2>Unidad médica</h2><div class="datos">
    ${dato('Unidad médica', form.nombre_unidad_medica)}${dato('Dirección', form.direccion)}
    ${dato('Ubicación / Área', form.ubicacion)}${dato('Contacto', form.contacto)}
    ${dato('No. de contrato / Programa', form.no_contrato)}${dato('Teléfono unidad', form.tel_unidad)}
    ${dato('Teléfono responsable', form.tel_responsable)}${dato('Tiempo de garantía', form.tiempo_garantia)}
  </div>
  <h2>Información del equipo</h2><div class="datos">
    ${dato('Equipo', form.equipo)}${dato('Marca y Modelo', marcaModelo)}
    ${dato('N/S', form.serie)}${dato('Inventario', form.inventario)}
  </div>
  ${bloque('Reporte', form.reporte)}
  ${bloque('Observaciones', form.observaciones)}
  ${bloque('Recomendaciones', recomendaciones)}
  ${bloque('Material y refacciones utilizadas', form.material_refacciones)}
  <h2>Pruebas eléctricas y simulador</h2><div class="datos">
    ${dato('Pruebas eléctricas', form.pruebas_electricas)}
  </div>
  <div class="observ"><b>Simulador:</b> ${texto(form.simulador, 'Sin resultados registrados')}</div>
  <h2>Firmas</h2><div class="firmas">
    ${bloqueFirma(firmaTecnico, `Técnico: ${form.tecnico_servicio || '—'}`)}
    ${bloqueFirma(firmaResponsable, `Responsable: ${form.responsable_unidad || '—'}`)}
  </div>
  ${cuadriculaFotos('Evidencia fotográfica — ANTES', fotosAntes.filter(Boolean))}
  ${cuadriculaFotos('Evidencia fotográfica — DESPUÉS', fotosDespues.filter(Boolean))}
  </body></html>`;

  const resultado = await Print.printToFileAsync({ html, base64: false });
  const carpeta = `${FileSystem.documentDirectory}ordenesServicio/pdfs/`;
  await FileSystem.makeDirectoryAsync(carpeta, { intermediates: true });
  const nombre = `Orden-${String(form.folio_orden || 'sin-folio').replace(/[^0-9A-Za-z_-]/g, '')}-${orden.empresaId || 'empresa'}.pdf`;
  const destino = carpeta + nombre;
  await FileSystem.deleteAsync(destino, { idempotent: true });
  await FileSystem.copyAsync({ from: resultado.uri, to: destino });
  return destino;
};

export const compartirPdfOrden = async (orden) => {
  const uri = await generarPdfOrden(orden);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('No hay una aplicación compatible para compartir el PDF.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Entregar copia de orden de servicio'
  });
  return uri;
};
