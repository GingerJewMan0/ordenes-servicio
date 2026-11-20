'use strict';
// Ejecutar desde backend/ con variables DATABASE_URL y REPORTES_WEB_ORIGIN.
// Mantener códigos QR y enlaces privados; nunca subir la carpeta private/ a Git.
require('dotenv').config();
const {Pool}=require('pg');
const QRCode=require('qrcode');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');

(async()=>{
  const args=process.argv.slice(2);
  const rotar=args.includes('--rotar');
  const pos=args.filter(x=>x!=='--rotar');
  const [codigo,nombre]=pos;
  const origin=(process.env.REPORTES_WEB_ORIGIN||'').replace(/\/$/,'');
  if (!codigo || !/^[A-Z0-9_-]{2,40}$/.test(codigo) ||
      !nombre || nombre.length>160 || !process.env.DATABASE_URL || !origin) {
    throw new Error('Uso: node scripts/crearQRHospital.cjs HOSP-001 "Hospital de ejemplo" [--rotar]. Configura DATABASE_URL y REPORTES_WEB_ORIGIN.');
  }
  const urlOrigin=new URL(origin);
  if ((urlOrigin.protocol!=='https:' && !(urlOrigin.protocol==='http:' && urlOrigin.hostname==='localhost')) ||
      urlOrigin.pathname!=='/' || urlOrigin.search || urlOrigin.hash) {
    throw new Error('REPORTES_WEB_ORIGIN debe ser un origen HTTPS sin ruta (o http://localhost para pruebas).');
  }
  const token=crypto.randomBytes(32).toString('base64url');
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  const enlace=`${origin}/hospital/${token}`;
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try {
    const previo=await pool.query('SELECT id FROM public.hospitales_reportantes WHERE codigo=$1',[codigo]);
    if (previo.rows[0] && !rotar) throw new Error('Ya existe ese código. Para invalidar el QR anterior y generar otro utiliza --rotar.');
    if (!previo.rows[0] && rotar) throw new Error('No existe ese hospital. Créalo primero sin --rotar.');
    if (rotar) {
      await pool.query('UPDATE public.hospitales_reportantes SET nombre=$1,token_sha256=$2,activo=TRUE,actualizado_en=NOW() WHERE codigo=$3',[nombre,hash,codigo]);
    } else {
      await pool.query('INSERT INTO public.hospitales_reportantes(codigo,nombre,token_sha256) VALUES($1,$2,$3)',[codigo,nombre,hash]);
    }
    const out=path.join(__dirname,'..','private','qr');
    await fs.mkdir(out,{recursive:true,mode:0o700});
    const destino=path.join(out,`${codigo}.png`);
    await QRCode.toFile(destino,enlace,{errorCorrectionLevel:'M',margin:2,width:650});
    console.log(`Hospital: ${nombre}\nOperación: ${rotar?'QR renovado; anterior invalidado':'QR creado'}\nQR privado: ${destino}\nEnlace privado: ${enlace}\n¡NO subas este archivo ni URL a repositorios públicos!`);
  } finally { await pool.end(); }
})().catch(e=>{console.error('Error:',e.message);process.exitCode=1;});
