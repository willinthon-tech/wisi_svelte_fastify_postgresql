<script>
  export let healthStatus = {};
  let activeTab = 'activity';
</script>

<div style="display: flex; flex-direction: column; gap: 24px;">
  <!-- Cover Banner & Profile Header -->
  <div class="flow-card" style="padding: 0; overflow: hidden; position: relative;">
    <div style="height: 160px; background: linear-gradient(135deg, #1c2247, #3b76ef);"></div>
    
    <div style="padding: 20px 24px; display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; background: #ffffff;">
      <div style="display: flex; align-items: flex-end; gap: 16px; margin-top: -50px;">
        <div style="width: 84px; height: 84px; border-radius: 50%; background: #3b76ef; color: #ffffff; font-size: 32px; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 4px solid #ffffff; box-shadow: 0 4px 10px rgba(0,0,0,0.15); z-index: 10;">
          A
        </div>
        <div>
          <h2 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 0;">Adrian Demian</h2>
          <p style="font-size: 13px; color: #64748b; margin: 0;">@AdrianDemian • Site Manager</p>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display: flex; gap: 6px;">
        <button on:click={() => (activeTab = 'activity')} class="btn-flow-sec {activeTab === 'activity' ? 'btn-flow' : ''}">Activity</button>
        <button on:click={() => (activeTab = 'purchases')} class="btn-flow-sec {activeTab === 'purchases' ? 'btn-flow' : ''}">Purchases</button>
        <button on:click={() => (activeTab = 'emails')} class="btn-flow-sec {activeTab === 'emails' ? 'btn-flow' : ''}">Emails</button>
        <button on:click={() => (activeTab = 'quotes')} class="btn-flow-sec {activeTab === 'quotes' ? 'btn-flow' : ''}">Quotes</button>
      </div>
    </div>
  </div>

  <!-- 2-Column Main Profile Layout -->
  <div style="display: grid; grid-template-columns: 280px 1fr; gap: 24px;">
    <!-- Left Column: Info Card -->
    <div class="flow-card" style="height: fit-content;">
      <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 12px;">About User</h3>
      <p style="font-size: 13px; color: #475569; line-height: 1.5; margin-bottom: 16px;">
        Bootstrap 4 & Svelte 5 Admin Dashboard Themes
      </p>

      <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12px;">
        <div style="display: flex; align-items: center; gap: 8px; color: #64748b;">
          <span class="material-icons" style="font-size: 18px; color: #94a3b8;">location_on</span>
          <span>Dracula's Castle, Transilvania</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; color: #64748b;">
          <span class="material-icons" style="font-size: 18px; color: #94a3b8;">link</span>
          <a href="https://www.frontted.com" target="_blank" style="color: #3b76ef; font-weight: 600; text-decoration: none;">frontted.com</a>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; color: #64748b;">
          <span class="material-icons" style="font-size: 18px; color: #94a3b8;">dns</span>
          <span>Backend API: <strong style="color: #10b981;">{healthStatus.status || 'Online'}</strong></span>
        </div>
      </div>
    </div>

    <!-- Right Column: Activity Timeline Feed Cards -->
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <!-- Post Card 1 -->
      <div class="flow-card">
        <div style="display: flex; gap: 12px; margin-bottom: 10px;">
          <div style="width: 38px; height: 38px; border-radius: 50%; background: #ec4899; color: #ffffff; font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            S
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="font-size: 14px; color: #0f172a;">Sherri J. Cardenas</strong>
              <span style="font-size: 11px; color: #94a3b8;">3 days ago</span>
            </div>
            <p style="font-size: 13px; color: #334155; margin-top: 6px; line-height: 1.5;">
              Thanks for contributing to the release of FREE Admin Vision - PRO Admin Dashboard Theme <a href="#link" on:click|preventDefault style="color: #3b76ef;">https://www.frontted.com/themes/...</a> 🔥
            </p>
            <p style="font-size: 12px; color: #3b76ef; margin-top: 4px;">#themeforest #EnvatoMarket</p>
          </div>
        </div>

        <div style="border-top: 1px solid #f1f5f9; padding-top: 10px; display: flex; gap: 16px; font-size: 12px; color: #64748b;">
          <button style="background: none; border: none; color: #64748b; display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <span class="material-icons" style="font-size: 16px;">favorite_border</span> 38
          </button>
          <button style="background: none; border: none; color: #64748b; display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <span class="material-icons" style="font-size: 16px;">thumb_up</span> 71
          </button>
        </div>
      </div>

      <!-- Post Card 2 -->
      <div class="flow-card">
        <div style="display: flex; gap: 12px; margin-bottom: 10px;">
          <div style="width: 38px; height: 38px; border-radius: 50%; background: #3b76ef; color: #ffffff; font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            A
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="font-size: 14px; color: #0f172a;">Adrian Demian</strong>
              <span style="font-size: 11px; color: #94a3b8;">Yesterday</span>
            </div>
            <p style="font-size: 13px; color: #334155; margin-top: 6px; line-height: 1.5;">
              FlowDash 120 Svelte 5 PWA components and Fastify REST API backend are fully deployed and persistent with PostgreSQL 16 🚀
            </p>
          </div>
        </div>

        <div style="border-top: 1px solid #f1f5f9; padding-top: 10px; display: flex; gap: 16px; font-size: 12px; color: #64748b;">
          <button style="background: none; border: none; color: #64748b; display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <span class="material-icons" style="font-size: 16px;">favorite_border</span> 124
          </button>
          <button style="background: none; border: none; color: #64748b; display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <span class="material-icons" style="font-size: 16px;">thumb_up</span> 95
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
