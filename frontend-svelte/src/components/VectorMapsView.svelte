<script>
  let mapPins = [
    { city: 'New York', country: 'United States', pin: '📍', color: '#3b76ef' },
    { city: 'Vatican City', country: 'Italy', pin: '📍', color: '#10b981' },
    { city: 'Tokyo', country: 'Japan', pin: '📍', color: '#f59e0b' }
  ];

  let countryGDP = [
    { country: 'United States', flag: '🇺🇸', gdp: '$21.43 Trillion', growth: '+2.3%' },
    { country: 'China', flag: '🇨🇳', gdp: '$14.34 Trillion', growth: '+6.1%' },
    { country: 'Japan', flag: '🇯🇵', gdp: '$5.08 Trillion', growth: '+0.7%' },
    { country: 'Germany', flag: '🇩🇪', gdp: '$3.86 Trillion', growth: '+1.5%' },
    { country: 'United Kingdom', flag: '🇬🇧', gdp: '$2.83 Trillion', growth: '+1.3%' }
  ];
</script>

<div class="grid-2-cols">
  <!-- Card 1: Vector Map Pins -->
  <div class="flow-card">
    <div style="margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">
      <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0;">Vector Map Pins (ui-vector-maps.html)</h3>
    </div>

    <div style="background: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 16px;">
      <span class="material-icons" style="font-size: 54px; color: #3b76ef; margin-bottom: 8px;">public</span>
      <h4 style="font-size: 15px; font-weight: 800; color: #1e40af; margin: 0;">World Interactive Pins</h4>
      <p style="font-size: 12px; color: #3b82f6; margin-top: 4px;">Live location pins for global office branches</p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
      {#each mapPins as pin}
        <div style="padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; color: #1e293b;">{pin.pin} {pin.city}</span>
          <span class="badge badge-blue">{pin.country}</span>
        </div>
      {/each}
    </div>
  </div>

  <!-- Card 2: Gross domestic product (GDP) by country -->
  <div class="flow-card">
    <div style="margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">
      <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0;">Gross domestic product (GDP) by country</h3>
    </div>

    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr style="background: #f8fafc;">
            <th>Country</th>
            <th style="text-align: right;">GDP</th>
            <th style="text-align: right;">Growth</th>
          </tr>
        </thead>
        <tbody>
          {#each countryGDP as item}
            <tr>
              <td style="font-weight: 600; color: #1e293b;">
                <span style="margin-right: 6px;">{item.flag}</span> {item.country}
              </td>
              <td style="text-align: right; font-family: monospace; font-weight: 700; color: #0f172a;">{item.gdp}</td>
              <td style="text-align: right; font-weight: 700; color: #10b981;">{item.growth}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
