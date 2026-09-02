<script>
  let activeTab = 'buttons';
  let sliderValue = 65;
  let selectedDate = '2026-08-17';
</script>

<div class="flow-card" style="margin-bottom: 20px;">
  <div style="display: flex; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 20px;">
    <button on:click={() => (activeTab = 'buttons')} class="btn-flow-sec {activeTab === 'buttons' ? 'btn-flow' : ''}">Buttons & Badges</button>
    <button on:click={() => (activeTab = 'avatars')} class="btn-flow-sec {activeTab === 'avatars' ? 'btn-flow' : ''}">Avatars</button>
    <button on:click={() => (activeTab = 'forms')} class="btn-flow-sec {activeTab === 'forms' ? 'btn-flow' : ''}">Form Controls</button>
    <button on:click={() => (activeTab = 'pagination')} class="btn-flow-sec {activeTab === 'pagination' ? 'btn-flow' : ''}">Pagination</button>
    <button on:click={() => (activeTab = 'loaders')} class="btn-flow-sec {activeTab === 'loaders' ? 'btn-flow' : ''}">Loaders & Spinners</button>
    <button on:click={() => (activeTab = 'sliders')} class="btn-flow-sec {activeTab === 'sliders' ? 'btn-flow' : ''}">Range Sliders</button>
    <button on:click={() => (activeTab = 'datetime')} class="btn-flow-sec {activeTab === 'datetime' ? 'btn-flow' : ''}">Date & Time</button>
  </div>

  {#if activeTab === 'buttons'}
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <h4 style="font-size: 14px; font-weight: 700; color: #1e293b;">Button Variants & Badges (ui-buttons.html)</h4>
      <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
        <button class="btn-flow">Primary Button</button>
        <button class="btn-flow-sec">Secondary Button</button>
        <button class="btn-flow" style="background: #10b981;">Success Button</button>
        <button class="btn-flow" style="background: #ef4444;">Danger Button</button>
        <span class="badge badge-blue">Primary Badge</span>
        <span class="badge badge-success">Success Badge</span>
        <span class="badge badge-warning">Warning Badge</span>
      </div>
    </div>
  {/if}

  {#if activeTab === 'avatars'}
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <h4 style="font-size: 14px; font-weight: 700; color: #1e293b;">Avatar Variations (ui-avatars.html)</h4>
      <div style="display: flex; gap: 16px; align-items: center;">
        <div style="width: 32px; height: 32px; border-radius: 50%; background: #3b76ef; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px;">S</div>
        <div style="width: 40px; height: 40px; border-radius: 50%; background: #6366f1; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; position: relative;">
          M
          <span style="position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; border-radius: 50%; background: #10b981; border: 2px solid #fff;"></span>
        </div>
        <div style="width: 48px; height: 48px; border-radius: 10px; background: #8b5cf6; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px;">L</div>
      </div>
    </div>
  {/if}

  {#if activeTab === 'forms'}
    <div class="grid-2-cols">
      <div class="form-group">
        <label for="comp-txt" class="form-label">Input Text</label>
        <input id="comp-txt" type="text" placeholder="Enter text..." class="form-input" />
      </div>
      <div class="form-group">
        <label for="comp-sel" class="form-label">Select Option</label>
        <select id="comp-sel" class="form-input">
          <option>Option 1 - Default</option>
          <option>Option 2 - Custom</option>
        </select>
      </div>
    </div>
  {/if}

  {#if activeTab === 'pagination'}
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <h4 style="font-size: 14px; font-weight: 700; color: #1e293b;">Pagination Component (ui-pagination.html)</h4>
      <div style="display: flex; gap: 6px;">
        <button class="btn-flow-sec">« Prev</button>
        <button class="btn-flow">1</button>
        <button class="btn-flow-sec">2</button>
        <button class="btn-flow-sec">3</button>
        <button class="btn-flow-sec">Next »</button>
      </div>
    </div>
  {/if}

  {#if activeTab === 'loaders'}
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <h4 style="font-size: 14px; font-weight: 700; color: #1e293b;">Loaders & Spinners (ui-loaders.html)</h4>
      <div style="display: flex; gap: 20px; align-items: center;">
        <div style="width: 28px; height: 28px; border: 3px solid #cbd5e1; border-top-color: #3b76ef; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <span style="font-size: 12px; color: #64748b;">Processing request...</span>
      </div>
    </div>

    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  {/if}

  {#if activeTab === 'sliders'}
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <h4 style="font-size: 14px; font-weight: 700; color: #1e293b;">Range Sliders (ui-range-sliders.html)</h4>
      <div style="max-width: 400px;">
        <label for="comp-slider" class="form-label">Value: {sliderValue}%</label>
        <input id="comp-slider" type="range" min="0" max="100" bind:value={sliderValue} style="width: 100%; cursor: pointer;" />
      </div>
    </div>
  {/if}

  {#if activeTab === 'datetime'}
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <h4 style="font-size: 14px; font-weight: 700; color: #1e293b;">Date & Time Pickers (ui-datetime.html)</h4>
      <div style="max-width: 300px;">
        <label for="comp-date" class="form-label">Select Date</label>
        <input id="comp-date" type="date" bind:value={selectedDate} class="form-input" />
      </div>
    </div>
  {/if}
</div>
