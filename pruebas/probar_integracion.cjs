'use strict';
// Prueba autocontenida: no usa red, PostgreSQL ni modifica órdenes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');
const originalLoad = Module._load;
const eventos = [];

function appStub() {
  const app = {};
  for (const name of ['use', 'get', 'post', 'set', 'listen']) {
    app[name] = function (...args) { eventos.push({name, args}); return app; };
  }
  return app;
}
function Router() {
  const rutas = new Map();
  return {
    rutas,
    use() {},
    post(p, ...handlers) {rutas.set('POST '+p, handlers);},
    get(p, ...handlers) {rutas.set('GET '+p, handlers);}
  };
}
function express() {return appStub();}
express.Router = Router;
express.json = () => (_req, _res, next) => next?.();
express.static = () => (_req, _res, next) => next?.();
const poolMock = { async query() { return {rows:[]}; } };
class Pool { constructor() {return poolMock;} }
Module._load = function(name, parent, isMain) {
  if (name==='express') return express;
  if (name==='pg') return {Pool};
  if (name==='cors') return () => (_req,_res,next) => next?.();
  if (name==='dotenv') return {config() {}};
  return originalLoad.call(this,name,parent,isMain);
};
let sec;
try {
  const file = path.join(__dirname,'..','server.js');
  delete require.cache[require.resolve(file)];
  require(file);
  sec = require(path.join(__dirname,'..','security','sesiones.js'));
} finally { Module._load = originalLoad; }

const indice = (name, route) => eventos.findIndex(e=>e.name===name && e.args[0]===route);
assert.ok(indice('use','/api/auth')>=0,'Falta montar /api/auth');
assert.ok(indice('use','/api/ordenes')>=0,'Falta middleware de órdenes');
assert.ok(indice('use','/api/ordenes') < indice('get','/api/ordenes'), 'GET órdenes sin middleware');
assert.ok(indice('use','/api/ordenes') < indice('post','/api/ordenes'), 'POST órdenes sin middleware');
assert.ok(indice('set','trust proxy')>=0,'Falta trust proxy');
assert.ok(eventos.some(e=>e.name==='listen'), 'No se encontró el servidor de escucha');

function respuesta() {return {code:200,cuerpo:null,cabeceras:{},status(n){this.code=n;return this;},json(x){this.cuerpo=x;return this;},set(k,v){this.cabeceras[k]=v;return this;}};}
function peticion(body={}, bearer=null) {return {body,ip:'127.0.0.1',get(h){return h==='authorization' && bearer?`Bearer ${bearer}`:null;}};}
async function ejecutar() {
  process.env.APP_AUTH_REQUIRED='true';
  const clave='ClaveFicticiaDePruebas2026';
  const salt=crypto.randomBytes(16).toString('hex');
  const hex=crypto.scryptSync(clave,Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
  const usuario={id:1,usuario:'administrador',rol:'admin',clave_hash:`scrypt$16384$8$1$${salt}$${hex}`};
  let hashTokenActual='';
  const pool={async query(sql,params=[]) {
    if (sql.includes('SELECT id, usuario, clave_hash')) return {rows:params[0]==='administrador'?[usuario]:[]};
    if (sql.includes('INSERT INTO public.app_sesiones')) {hashTokenActual=params[1];return {rows:[]};}
    if (sql.includes('SELECT s.id AS sesion_id')) return {rows:params[0]===hashTokenActual && hashTokenActual?[{id:1,usuario:'administrador',rol:'admin',sesion_id:7}]:[]};
    if (sql.includes('DELETE FROM public.app_sesiones WHERE token_hash')) {hashTokenActual='';return {rows:[]};}
    return {rows:[]};
  }};
  const seguridad=sec.crearSeguridad(pool);
  // Rutas protegidas: sin token deben bloquearse con HTTP 401.
  let r=respuesta(), siguiente=false;
  await seguridad.requerirSesion(peticion(),r,()=>{siguiente=true;});
  assert.equal(r.code,401);assert.equal(siguiente,false);
  // Login contra la misma estructura de scrypt que creó el generador.
  r=respuesta();await seguridad.router.rutas.get('POST /login')[0](peticion({usuario:'administrador',clave}),r);
  assert.equal(r.code,200);assert.equal(r.cuerpo.usuario.rol,'admin');
  const token=r.cuerpo.token;
  assert.equal(hashTokenActual,crypto.createHash('sha256').update(token).digest('hex'));
  // Una petición autenticada sí tiene acceso.
  r=respuesta();siguiente=false;
  await seguridad.requerirSesion(peticion({},token),r,()=>{siguiente=true;});
  assert.equal(siguiente,true);
  // Logout anula el token.
  const logoutHandlers=seguridad.router.rutas.get('POST /logout');
  const reqLogout=peticion({},token);r=respuesta();
  await logoutHandlers[0](reqLogout,r,()=>{});
  await logoutHandlers[1](reqLogout,r);
  assert.equal(r.cuerpo.sesionCerrada,true);
  r=respuesta();siguiente=false;
  await seguridad.requerirSesion(peticion({},token),r,()=>{siguiente=true;});
  assert.equal(r.code,401);assert.equal(siguiente,false);
  console.log('OK: middleware antes de GET/POST, 401 sin token, login, Bearer valido y logout.');
}
ejecutar().catch(e=>{console.error(e);process.exitCode=1;});
