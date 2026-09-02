<script>
  let products = [
    { id: 1, name: 'FlowDash Admin Pro Theme', category: 'Templates', price: '$49.00', stock: 'In Stock', rating: '5.0 (42 reviews)', icon: '🎨' },
    { id: 2, name: 'PostgreSQL Cloud Connector', category: 'Database', price: '$29.00', stock: 'In Stock', rating: '4.9 (18 reviews)', icon: '🐘' },
    { id: 3, name: 'Svelte 5 PWA Starter Kit', category: 'Frontend', price: '$39.00', stock: 'In Stock', rating: '4.8 (35 reviews)', icon: '⚡' },
    { id: 4, name: 'Fastify REST API Boilerplate', category: 'Backend', price: '$19.00', stock: 'In Stock', rating: '4.9 (50 reviews)', icon: '🚀' },
    { id: 5, name: 'Glassmorphism UI Component Pack', category: 'Design', price: '$25.00', stock: 'Limited', rating: '4.7 (12 reviews)', icon: '✨' },
    { id: 6, name: 'Docker Compose Container Manager', category: 'DevOps', price: '$15.00', stock: 'In Stock', rating: '5.0 (27 reviews)', icon: '🐳' }
  ];
</script>

<div class="grid-3-cols">
  {#each products as prod (prod.id)}
    <div class="flow-card" style="display: flex; flex-direction: column; justify-content: space-between;">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div style="width: 44px; height: 44px; border-radius: 8px; background: #eff6ff; color: #3b76ef; font-size: 22px; display: flex; align-items: center; justify-content: center; border: 1px solid #dbeafe;">
            {prod.icon}
          </div>
          <span class="badge badge-blue">{prod.category}</span>
        </div>

        <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">{prod.name}</h3>
        <p style="font-size: 12px; color: #64748b; margin-bottom: 16px;">⭐ {prod.rating}</p>
      </div>

      <div style="border-top: 1px solid #f1f5f9; padding-top: 14px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; display: block;">Price</span>
          <span style="font-size: 18px; font-weight: 800; color: #0f172a;">{prod.price}</span>
        </div>
        <button class="btn-flow">Buy Now</button>
      </div>
    </div>
  {/each}
</div>
