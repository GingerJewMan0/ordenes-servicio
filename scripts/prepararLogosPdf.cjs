// Ejecutar desde la raíz del proyecto: node scripts/prepararLogosPdf.cjs
// No necesita instalar dependencias adicionales ni conectarse a internet.
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');

const buscarLogo = (empresa, opciones) => {
  for (const archivo of opciones) {
    const ruta = path.join(raiz, archivo);
    if (fs.existsSync(ruta) && fs.statSync(ruta).isFile()) return ruta;
  }
  throw new Error(`No se encontró el logo de ${empresa}. Revisa estas rutas: ${opciones.join(', ')}`);
};

const rutas = {
  opciones: buscarLogo('Opciones Médicas', [
    'assets/logos/ome.png',
    'assets/logos/opciones.png',
    'assets/logos/ome.jpg',
    'assets/logos/opciones.jpg'
  ]),
  mexus: buscarLogo('Mexus Hospitalaria', [
    'assets/logos/mexus.png',
    'assets/logos/mexus.jpg'
  ])
};

const logos = {};
for (const [empresa, archivo] of Object.entries(rutas)) {
  const buffer = fs.readFileSync(archivo);
  if (!buffer.length) throw new Error(`El logo ${archivo} está vacío.`);
  const ext = path.extname(archivo).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  logos[empresa] = `data:${mime};base64,${buffer.toString('base64')}`;
  console.log(`Logo de ${empresa}: ${path.relative(raiz, archivo)} (${buffer.length} bytes)`);
}
const salida = path.join(raiz, 'src', 'services', 'logosPdfBase64.js');
fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, '// Generado automáticamente desde assets/logos. No editar a mano.\nexport const LOGOS_PDF = ' + JSON.stringify(logos, null, 2) + ';\n', 'utf8');
console.log('Listo: src/services/logosPdfBase64.js');
