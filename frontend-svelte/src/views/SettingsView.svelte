<script>
  export let healthStatus = { status: 'desconocido', database: {} };
</script>

<div class="flow-card">
  <h3 style="font-size: 16px; font-weight: 700; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px;">
    ⚙️ Diagnóstico del Sistema y Base de Datos PostgreSQL
  </h3>
  <div style="font-size: 13px; font-family: monospace; display: flex; flex-direction: column; gap: 8px;">
    <p style="margin: 0;">Servidor Fastify API: <strong style="color: #10b981;">{healthStatus.status}</strong></p>
    <p style="margin: 0;">Motor de BD: <strong>{healthStatus.database?.mode || 'N/A'}</strong> ({healthStatus.database?.host || 'N/A'})</p>
    <p style="margin: 0;">Nombre de BD: <strong>{healthStatus.database?.database || 'N/A'}</strong></p>
  </div>
</div>
