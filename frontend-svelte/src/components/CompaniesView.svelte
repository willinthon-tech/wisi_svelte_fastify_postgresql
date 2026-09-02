<script>
  let companies = [
    { id: 1, name: 'WISI Global Tech', category: 'Software Development', location: 'San Francisco, CA', team: '45 members', revenue: '$1.2M', status: 'Active Partner', logo: '🌐' },
    { id: 2, name: 'Postgres Cloud Systems', category: 'Database Services', location: 'New York, NY', team: '120 members', revenue: '$4.5M', status: 'Enterprise', logo: '🐘' },
    { id: 3, name: 'Svelte Core Labs', category: 'Open Source', location: 'Austin, TX', team: '28 members', revenue: '$850K', status: 'Sponsor', logo: '⚡' },
    { id: 4, name: 'Fastify Node Framework', category: 'Backend Engine', location: 'London, UK', team: '65 members', revenue: '$2.1M', status: 'Verified', logo: '🚀' }
  ];
</script>

<div class="grid-2-cols">
  {#each companies as comp (comp.id)}
    <div class="flow-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
        <div style="display: flex; gap: 14px; align-items: center;">
          <div style="width: 48px; height: 48px; border-radius: 10px; background: #f8fafc; font-size: 24px; display: flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0;">
            {comp.logo}
          </div>
          <div>
            <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0;">{comp.name}</h3>
            <p style="font-size: 12px; color: #64748b; margin: 2px 0 0 0;">{comp.category} • {comp.location}</p>
          </div>
        </div>
        <span class="badge badge-success">{comp.status}</span>
      </div>

      <div style="border-top: 1px solid #f1f5f9; padding-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px;">
        <div>
          <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; display: block;">Team Size</span>
          <span style="font-weight: 600; color: #334155;">{comp.team}</span>
        </div>
        <div>
          <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; display: block;">Annual Revenue</span>
          <span style="font-weight: 700; color: #0f172a;">{comp.revenue}</span>
        </div>
      </div>
    </div>
  {/each}
</div>
