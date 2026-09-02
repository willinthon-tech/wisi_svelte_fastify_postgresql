<script>
  import DashboardStats from '../components/DashboardStats.svelte';

  export let items = [];
</script>

<div>
  <!-- KPI Overview Stats -->
  <DashboardStats {items} />
</div>
