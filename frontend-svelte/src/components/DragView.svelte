<script>
  let dragCards = [
    { id: 1, text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante.', bg: '#3b76ef', title: 'Primary Card' },
    { id: 2, text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante.', bg: '#1c2247', title: 'Dark Card' },
    { id: 3, text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante.', bg: '#10b981', title: 'Success Card' },
    { id: 4, text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante.', bg: '#06b6d4', title: 'Info Card' },
    { id: 5, text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante.', bg: '#f59e0b', title: 'Warning Card' },
    { id: 6, text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante.', bg: '#ef4444', title: 'Danger Card' }
  ];

  let draggedIndex = null;

  function handleDragStart(index) {
    draggedIndex = index;
  }

  function handleDragOver(e, index) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const card = dragCards[draggedIndex];
    dragCards.splice(draggedIndex, 1);
    dragCards.splice(index, 0, card);
    draggedIndex = index;
    dragCards = [...dragCards];
  }

  function handleDragEnd() {
    draggedIndex = null;
  }
</script>

<div class="flow-card">
  <div style="margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px;">
    <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0;">Simple Drag and Drop (ui-drag.html)</h3>
    <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">Drag and drop cards across grid positions in real-time</p>
  </div>

  <div class="grid-3-cols">
    {#each dragCards as card, index (card.id)}
      <div 
        draggable="true"
        role="button"
        tabindex="0"
        on:dragstart={() => handleDragStart(index)}
        on:dragover={(e) => handleDragOver(e, index)}
        on:dragend={handleDragEnd}
        style="background: {card.bg}; color: #ffffff; padding: 20px; border-radius: 8px; cursor: grab; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); transition: transform 0.15s ease;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-weight: 700; font-size: 12px; opacity: 0.9;">{card.title}</span>
          <span class="material-icons" style="font-size: 18px; opacity: 0.7;">drag_indicator</span>
        </div>
        <p style="font-size: 13px; line-height: 1.5; margin: 0; opacity: 0.95;">
          {card.text}
        </p>
      </div>
    {/each}
  </div>
</div>
