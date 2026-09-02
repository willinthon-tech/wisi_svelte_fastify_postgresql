import { sql, isPgConnected, inMemoryItems, setInMemoryItems } from '../config/db.js';

export async function getItemsModel({ search, category, completed }) {
  if (isPgConnected && sql) {
    let query = sql`SELECT * FROM wisi_items WHERE 1=1`;
    
    if (search) {
      const searchPattern = `%${search}%`;
      query = sql`${query} AND (title ILIKE ${searchPattern} OR description ILIKE ${searchPattern})`;
    }
    if (category && category !== 'All') {
      query = sql`${query} AND category = ${category}`;
    }
    if (completed !== undefined && completed !== null && completed !== '') {
      const isCompleted = completed === 'true' || completed === true;
      query = sql`${query} AND completed = ${isCompleted}`;
    }
    query = sql`${query} ORDER BY id DESC`;
    return await query;
  } else {
    let items = [...inMemoryItems];
    if (search) {
      const s = search.toLowerCase();
      items = items.filter(i => i.title.toLowerCase().includes(s) || (i.description && i.description.toLowerCase().includes(s)));
    }
    if (category && category !== 'All') {
      items = items.filter(i => i.category === category);
    }
    if (completed !== undefined && completed !== null && completed !== '') {
      const isCompleted = completed === 'true' || completed === true;
      items = items.filter(i => i.completed === isCompleted);
    }
    return items.sort((a, b) => b.id - a.id);
  }
}

export async function createItemModel({ title, description, category, priority }) {
  if (isPgConnected && sql) {
    const rows = await sql`
      INSERT INTO wisi_items (title, description, category, priority)
      VALUES (${title}, ${description || ''}, ${category || 'General'}, ${priority || 'Medium'})
      RETURNING *
    `;
    return rows[0];
  } else {
    const newItem = {
      id: inMemoryItems.length ? Math.max(...inMemoryItems.map(i => i.id)) + 1 : 1,
      title,
      description: description || '',
      category: category || 'General',
      priority: priority || 'Medium',
      completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryItems.push(newItem);
    return newItem;
  }
}

export async function updateItemModel(id, { title, description, category, priority, completed }) {
  const itemId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE wisi_items
      SET 
        title = COALESCE(${title}, title),
        description = COALESCE(${description}, description),
        category = COALESCE(${category}, category),
        priority = COALESCE(${priority}, priority),
        completed = COALESCE(${completed}, completed),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${itemId}
      RETURNING *
    `;
    return rows[0] || null;
  } else {
    const index = inMemoryItems.findIndex(i => i.id === itemId);
    if (index === -1) return null;
    const existing = inMemoryItems[index];
    const updated = {
      ...existing,
      title: title !== undefined ? title : existing.title,
      description: description !== undefined ? description : existing.description,
      category: category !== undefined ? category : existing.category,
      priority: priority !== undefined ? priority : existing.priority,
      completed: completed !== undefined ? completed : existing.completed,
      updated_at: new Date().toISOString()
    };
    inMemoryItems[index] = updated;
    return updated;
  }
}

export async function toggleItemStatusModel(id) {
  const itemId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE wisi_items
      SET completed = NOT completed, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${itemId}
      RETURNING *
    `;
    return rows[0] || null;
  } else {
    const item = inMemoryItems.find(i => i.id === itemId);
    if (!item) return null;
    item.completed = !item.completed;
    item.updated_at = new Date().toISOString();
    return item;
  }
}

export async function deleteItemModel(id) {
  const itemId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      DELETE FROM wisi_items WHERE id = ${itemId} RETURNING id
    `;
    return rows.length > 0;
  } else {
    const initialLength = inMemoryItems.length;
    const filtered = inMemoryItems.filter(i => i.id !== itemId);
    setInMemoryItems(filtered);
    return filtered.length < initialLength;
  }
}
