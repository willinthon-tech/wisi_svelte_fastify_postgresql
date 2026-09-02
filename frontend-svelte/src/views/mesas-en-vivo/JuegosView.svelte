<script>
  import DataTableView from '../DataTableView.svelte';
  export let items = [];
</script>

<DataTableView 
  {items}
  on:toggle
  on:edit
  on:delete
  on:openModal
  on:saveInline
/>
