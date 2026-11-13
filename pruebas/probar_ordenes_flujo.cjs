'use strict';
// Ejecuta los handlers de server.js con un PostgreSQL y una app Express simulados.
// NO hay conexiones de red y NO se toca PostgreSQL real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const routes = {};
const apps = { get: {}, post: {}, patch: {}, put: {}, delete: {} };
const app = {
  set() {}, use() {}, listen() {},
  get(p,...h) {apps.get[p]=h},
  post(p,...h) {apps.post[p]=h},
  patch(p,...h) {apps.patch[p]=h},
  put(p,...h) {apps.put[p]=h},
  delete(p,...h) {apps.delete[p]=h}
};
const express = () => app;
express.json = () => (req,res,next)=>next();
express.static = () => (req,res,next)=>next();
const queries = [];
const aud = [];
let auditFail=false;
const dbClient = {
  async query(sql,values) {
    queries.push({sql:String(sql),values});
    const s=String(sql).trim().replace(/\s+/g,' ').toUpperCase();
    if (s.startsWith('INSERT INTO PUBLIC.ORDENES_SERVICIO')) return {rows:[{id:2,folio_orden:1002}]};
    if (s.startsWith('UPDATE PUBLIC.ORDENES_SERVICIO SET ELIMINADO_EN')) return {rows:[{id:2, folio_orden:1002}]};
    if (s.startsWith('UPDATE PUBLIC.ORDENES_SERVICIO')) return {rows:[{id:2,folio_orden:1002,observaciones:'Nueva'}]};
    if (s.startsWith('SELECT ID, FOLIO_ORDEN FROM')) return {rows:[{id:2,folio_orden:1002}]};
    if (s.startsWith('SELECT * FROM PUBLIC.ORDENES_SERVICIO')) return {rows:[{id:2, folio_orden:1002}]};
    return {rows:[]};
  }, release(){}
};
class Pool {connect(){return Promise.resolve(dbClient)} query(...a){return dbClient.query(...a)}};
const imports = {
  express, pg:{Pool}, cors:()=>()=>{}, path, dotenv:{config(){}},
  './security/sesiones':{crearSeguridad:()=>({router:()=>{}, requerirSesion:()=>{}, soloAdmin:()=>{}})},
  './security/auditoria':{registrarAuditoria:async (_db,req,detalle)=>{if(auditFail)throw Error('audit down');aud.push({usuario:req.usuarioApp.usuario,...detalle});}}
};
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
vm.runInNewContext(source,{require(name){if(!(name in imports))throw Error('Unexpected import '+name);return imports[name]},console,process:{env:{APP_AUTH_REQUIRED:'true'}},__dirname:path.join(__dirname,'..')},{filename:'server.js'});
function respuesta(){return {
 code:200,data:null, status(code){this.code=code;return this}, json(data){this.data=data;return this}, send(data){this.data=data;return this}
}}
async function run(method,p,req){
  const handlers=apps[method][p];assert.ok(handlers,`${method} ${p} no registrada`);
  const res=respuesta();
  for (let i=0;i<handlers.length;i++) {
    let next=false;
    await handlers[i](req,res,()=>{next=true});
    if (i<handlers.length-1 && !next) break;
  }
  return res;
}
const tecnica={id:4,usuario:'tecnico1',rol:'tecnico'};
const admin={id:1,usuario:'administrador',rol:'admin'};
(async()=>{
  let r=await run('delete','/api/ordenes/:id',{params:{id:'2'},usuarioApp:tecnica});
  assert.equal(r.code,403);assert.equal(queries.length,0);assert.equal(aud.length,0);
  r=await run('delete','/api/ordenes/:id',{params:{id:'2'},usuarioApp:admin});
  assert.equal(r.code,200); assert.equal(r.data.eliminada,true);
  assert.ok(queries.some(q=>q.sql.includes('eliminado_en = NOW()')));
  assert.deepEqual(aud[0],{usuario:'administrador',modulo:'ordenes',accion:'eliminar',registroId:2,folio:1002});
  queries.length=0;
  r=await run('patch','/api/ordenes/:id',{params:{id:'2'},usuarioApp:tecnica,body:{observaciones:'Nueva'}});
  assert.equal(r.code,200);
  assert.ok(queries.some(q=>q.sql.includes('"observaciones" = $1')));
  assert.equal(aud[1].accion,'editar');assert.equal(aud[1].usuario,'tecnico1');
  queries.length=0;
  r=await run('patch','/api/ordenes/:id',{params:{id:'2'},usuarioApp:tecnica,body:{folio_orden:9999}});
  assert.equal(r.code,400);assert.equal(queries.length,0);
  r=await run('patch','/api/ordenes/:id',{params:{id:'mal'},usuarioApp:admin,body:{observaciones:'n'}});
  assert.equal(r.code,400);
  r=await run('post','/api/ordenes',{usuarioApp:admin,body:{}});
  assert.equal(r.code,201);assert.equal(aud[2].accion,'crear');
  const antes=aud.length;
  auditFail=true;queries.length=0;
  r=await run('patch','/api/ordenes/:id',{params:{id:'2'},usuarioApp:admin,body:{observaciones:'Rechazado'}});
  assert.equal(r.code,500);assert.equal(aud.length,antes);
  assert.ok(queries.some(q=>String(q.sql)==='ROLLBACK'));
  console.log('OK: técnico DELETE=403, admin eliminación lógica, técnico edición, folio inmutable, crear con auditoría y ROLLBACK si falla auditoría.');
})().catch(e=>{console.error(e);process.exitCode=1});
