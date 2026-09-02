<script>
  export let items = [];
</script>

<div class="flow-card">
  <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
    📊 Analítica y Resumen de Métricas
  </h3>
  <div class="grid-3-cols">
    <div style="padding: 16px; background: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px;">
      <span style="font-weight: 700; color: #475569; display: block; font-size: 12px;">Total de Elementos</span>
      <span style="font-size: 26px; font-weight: 800; color: #3b76ef;">{items.length}</span>
    </div>
    <div style="padding: 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px;">
      <span style="font-weight: 700; color: #475569; display: block; font-size: 12px;">Tasa de Completado</span>
      <span style="font-size: 26px; font-weight: 800; color: #10b981;">
        {items.length ? Math.round((items.filter(i => i.completed).length / items.length) * 100) : 0}%
      </span>
    </div>
    <div style="padding: 16px; background: #f3e8ff; border: 1px solid #e9d5ff; border-radius: 8px;">
      <span style="font-weight: 700; color: #475569; display: block; font-size: 12px;">Categorías Activas</span>
      <span style="font-size: 26px; font-weight: 800; color: #a855f7;">{new Set(items.map(i => i.category)).size}</span>
    </div>
  </div>
</div>
