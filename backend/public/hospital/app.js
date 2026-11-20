'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const token = location.pathname.split('/').filter(Boolean).pop() || '';
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
  const base = `/api/reportes-hospitalarios/publico/${encodeURIComponent(token)}`;
  const alertBox = byId('alert');
  const form = byId('form');
  const btn = byId('enviar');
  function alertar(message) { alertBox.textContent=message; alertBox.hidden=false; alertBox.scrollIntoView({block:'nearest',behavior:'smooth'}); }
  async function verificar() {
    if (!validToken) return alertar('Este enlace no es válido. Solicita un nuevo código QR a Servicio Técnico.');
    try {
      const r = await fetch(`${base}/hospital`, {cache:'no-store',referrerPolicy:'no-referrer'});
      if (!r.ok) throw new Error('El enlace es inválido, caducó o fue desactivado.');
      const d = await r.json();
      byId('hospital-name').textContent=d.nombre;
      byId('hospital-state').textContent='Verificado';
      form.hidden=false;
    } catch(err) { byId('hospital-name').textContent='No disponible'; byId('hospital-state').textContent='Sin acceso'; alertar(err.message); }
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const data=Object.fromEntries(new FormData(form).entries());
    alertBox.hidden=true; btn.disabled=true; btn.textContent='Enviando…';
    try {
      const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),referrerPolicy:'no-referrer'});
      const d=await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo guardar el reporte.');
      byId('folio').textContent=d.folio;
      form.hidden=true; byId('success').hidden=false; window.scrollTo({top:0,behavior:'smooth'});
    } catch(err) { alertar(`${err.message} Si hubo un error de conexión, confirma con Servicio Técnico antes de volver a enviar para evitar duplicados.`); }
    finally { btn.disabled=false; btn.textContent='Enviar reporte →'; }
  });
  byId('nuevo').addEventListener('click',()=>{ form.reset();form.hidden=false;byId('success').hidden=true;alertBox.hidden=true;window.scrollTo({top:0,behavior:'smooth'});});
  verificar();
})();
