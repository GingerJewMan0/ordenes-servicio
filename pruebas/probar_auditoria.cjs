'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {registrarAuditoria} = require('../backend/security/auditoria');

(async () => {
  const queries=[];
  const db={query: async (sql, valores) => {queries.push({sql,valores});return {rows:[]};}};
  const req={usuarioApp:{id:'2',usuario:'tecnico1',rol:'tecnico'},body:{clave:'NUNCA_REGISTRAR'}};
  await registrarAuditoria(db,req,{modulo:'viaticos',accion:'editar',registroId:5,folio:'V-0005'});
  assert.equal(queries.length,1);
  assert.match(queries[0].sql,/INSERT INTO public\.app_auditoria/);
  assert.deepEqual(queries[0].valores,['2','tecnico1','tecnico','viaticos','editar','5','V-0005']);
  assert.ok(!JSON.stringify(queries).includes('NUNCA_REGISTRAR'));
  await assert.rejects(() => registrarAuditoria(db, {}, {modulo:'viaticos',accion:'crear',registroId:4}), /sesión válida/);
  await assert.rejects(() => registrarAuditoria(db, req, {modulo:'hack',accion:'crear'}), /no permitida/);
  assert.equal(queries.length,1, 'No insertar eventos inválidos');
  const viaticos=fs.readFileSync(path.resolve(__dirname,'../backend/routes/viaticos.js'),'utf8');
  const admin=fs.readFileSync(path.resolve(__dirname,'../backend/routes/adminUsuarios.js'),'utf8');
  assert.ok((viaticos.match(/await registrarAuditoria\(/g)||[]).length===3,'viaticos: crear/editar/eliminar');
  assert.ok((admin.match(/await registrarAuditoria\(/g)||[]).length===4,'usuarios: alta, nombre, activación y clave');
  console.log('OK: helper de auditoría, parámetros seguros, sesiones y 7 puntos de registro.');
})().catch(e=>{console.error(e);process.exitCode=1;});
