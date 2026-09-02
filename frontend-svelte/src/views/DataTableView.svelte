<script>
  import DataTable from '../components/DataTable.svelte';

  export let items = [];
</script>

<div class="space-y-4">
  <!-- Clean Data Table with Inline Editing -->
  <DataTable 
    {items} 
    on:openModal
    on:toggle
    on:edit
    on:delete
    on:saveInline
  />
</div>
