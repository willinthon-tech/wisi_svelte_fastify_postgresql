<script>
  function handlePrint() {
    window.print();
  }
</script>

<div style="max-width: 840px; margin: 0 auto;">
  <!-- Print Button Bar -->
  <div style="display: flex; justify-content: flex-end; margin-bottom: 16px;">
    <button on:click={handlePrint} class="btn-flow">
      <span class="material-icons" style="font-size: 16px;">print</span>
      <span>Print Invoice</span>
    </button>
  </div>

  <!-- FlowDash Official Invoice Card -->
  <div class="flow-card" style="padding: 40px; background: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    
    <!-- Top Overdue/Paid Status Badge -->
    <div style="display: flex; justify-content: flex-end; margin-bottom: 20px;">
      <span class="badge" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 4px 10px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px;">
        OVERDUE
      </span>
    </div>

    <!-- Center Brand Header -->
    <div style="text-align: center; margin-bottom: 36px;">
      <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #3b76ef, #6366f1); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #ffffff; margin: 0 auto 10px auto;">
        <span class="material-icons" style="font-size: 24px;">dashboard</span>
      </div>
      <h2 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 0;">Invoice</h2>
      <span style="font-size: 13px; color: #64748b; font-weight: 500;">Invoice #MPS1234AD</span>
    </div>

    <!-- Address & Invoice Info 2-Column Row -->
    <div class="grid-2-cols" style="margin-bottom: 36px; padding-bottom: 24px; border-bottom: 1px solid #f1f5f9;">
      <!-- FROM -->
      <div>
        <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; display: block; margin-bottom: 6px;">FROM</span>
        <p style="font-size: 13px; color: #334155; line-height: 1.5; margin-bottom: 14px;">
          <strong style="color: #0f172a; font-size: 14px;">Adrian Demian</strong><br />
          959 Emerson Road<br />
          Winnfield, LA
        </p>
        <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; display: block; margin-bottom: 2px;">INVOICE NUMBER</span>
        <span style="font-size: 13px; font-weight: 700; color: #0f172a; font-family: monospace;">#MPS1234AD</span>
      </div>

      <!-- TO (CUSTOMER) -->
      <div style="text-align: right;">
        <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; display: block; margin-bottom: 6px;">TO (CUSTOMER)</span>
        <p style="font-size: 13px; color: #334155; line-height: 1.5; margin-bottom: 14px;">
          <strong style="color: #0f172a; font-size: 14px;">Daniel J. Batiste</strong><br />
          3700 George Avenue<br />
          Mobile, AL 36602
        </p>
        <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; display: block; margin-bottom: 2px;">DUE DATE</span>
        <span style="font-size: 13px; font-weight: 700; color: #dc2626;">Nov 1st, 2018</span>
      </div>
    </div>

    <!-- Itemized Line Items Table -->
    <div class="table-container" style="margin-bottom: 28px;">
      <table class="data-table">
        <thead>
          <tr style="background: #f8fafc;">
            <th style="padding: 12px 16px;">Description</th>
            <th style="padding: 12px 16px; text-align: center;">Hours</th>
            <th style="padding: 12px 16px; text-align: right;">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight: 600; color: #1e293b;">Layout &amp; Sidebar Design</td>
            <td style="text-align: center; color: #64748b;">200</td>
            <td style="text-align: right; font-family: monospace; font-weight: 600; color: #0f172a;">$2,500</td>
          </tr>
          <tr>
            <td style="font-weight: 600; color: #1e293b;">Concept Design</td>
            <td style="text-align: center; color: #64748b;">2</td>
            <td style="text-align: right; font-family: monospace; font-weight: 600; color: #0f172a;">$1,000</td>
          </tr>
          <tr style="background: #f8fafc; border-top: 2px solid #e2e8f0;">
            <td style="font-weight: 800; color: #0f172a; font-size: 14px;">Total amount due</td>
            <td colspan="2" style="text-align: right; font-size: 18px; font-weight: 800; color: #3b76ef; font-family: monospace;">$3,500</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Notes Footer Section -->
    <div style="background: #f8fafc; border-radius: 6px; padding: 14px 18px; border: 1px solid #e2e8f0;">
      <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.8px; display: block; margin-bottom: 4px;">NOTES</span>
      <p style="font-size: 12px; color: #64748b; margin: 0; line-height: 1.4;">
        We appreciate your business. Should you need us to add VAT or extra notes let us know!
      </p>
    </div>

  </div>
</div>
