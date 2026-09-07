import { sql, isPgConnected } from '../config/db.js';

export async function getItemsModel({ search, category, completed }) {
  if (!isPgConnected || !sql) {
    return [];
  }
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
}

export async function createItemModel({ title, description, category, priority }) {
  if (!isPgConnected || !sql) {
    throw new Error('Base de datos PostgreSQL no conectada');
  }
  const rows = await sql`
    INSERT INTO wisi_items (title, description, category, priority)
    VALUES (${title}, ${description || ''}, ${category || 'General'}, ${priority || 'Medium'})
    RETURNING *
  `;
  return rows[0];
}

export async function updateItemModel(id, { title, description, category, priority, completed }) {
  const itemId = Number(id);
  if (!isPgConnected || !sql) {
    throw new Error('Base de datos PostgreSQL no conectada');
  }
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
}

export async function toggleItemStatusModel(id) {
  const itemId = Number(id);
  if (!isPgConnected || !sql) {
    throw new Error('Base de datos PostgreSQL no conectada');
  }
  const rows = await sql`
    UPDATE wisi_items
    SET completed = NOT completed, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${itemId}
    RETURNING *
  `;
  return rows[0] || null;
}

export async function deleteItemModel(id) {
  const itemId = Number(id);
  if (!isPgConnected || !sql) {
    throw new Error('Base de datos PostgreSQL no conectada');
  }
  const rows = await sql`
    DELETE FROM wisi_items WHERE id = ${itemId} RETURNING id
  `;
  return rows.length > 0;
}

