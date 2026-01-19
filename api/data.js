import { kv } from '@vercel/kv';

const DATA_KEY = 'funnel_data';
const BACKUP_PREFIX = 'funnel_backup_';
const MAX_BACKUPS = 10;

// Simple password check
function checkAuth(req) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.slice(7);
  return token === process.env.ADMIN_PASSWORD;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  
  // Public embed data - no auth required
  if (action === 'embed') {
    try {
      const data = await kv.get(DATA_KEY);
      return Response.json(data || { tiles: [], table: [] });
    } catch (error) {
      return Response.json({ tiles: [], table: [] });
    }
  }
  
  // Admin actions require auth
  if (!checkAuth(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    if (action === 'backups') {
      // List available backups
      const keys = await kv.keys(BACKUP_PREFIX + '*');
      const backups = keys.map(k => ({
        key: k,
        date: k.replace(BACKUP_PREFIX, '')
      })).sort((a, b) => b.date.localeCompare(a.date));
      return Response.json({ backups });
    }
    
    if (action === 'restore') {
      const backupKey = searchParams.get('key');
      if (!backupKey) {
        return Response.json({ error: 'Missing backup key' }, { status: 400 });
      }
      const data = await kv.get(backupKey);
      if (!data) {
        return Response.json({ error: 'Backup not found' }, { status: 404 });
      }
      return Response.json(data);
    }
    
    // Default: get current data
    const data = await kv.get(DATA_KEY);
    return Response.json(data || { tiles: [], table: [] });
    
  } catch (error) {
    console.error('GET error:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const body = await request.json();
    const { action, data } = body;
    
    if (action === 'save') {
      // Create backup before saving
      const existing = await kv.get(DATA_KEY);
      if (existing) {
        const backupKey = BACKUP_PREFIX + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        await kv.set(backupKey, existing);
        
        // Clean old backups (keep MAX_BACKUPS)
        const keys = await kv.keys(BACKUP_PREFIX + '*');
        if (keys.length > MAX_BACKUPS) {
          const sortedKeys = keys.sort();
          const toDelete = sortedKeys.slice(0, keys.length - MAX_BACKUPS);
          for (const k of toDelete) {
            await kv.del(k);
          }
        }
      }
      
      // Save new data
      await kv.set(DATA_KEY, data);
      return Response.json({ success: true, timestamp: new Date().toISOString() });
    }
    
    if (action === 'import') {
      // Direct import without backup (for initial setup)
      await kv.set(DATA_KEY, data);
      return Response.json({ success: true, timestamp: new Date().toISOString() });
    }
    
    return Response.json({ error: 'Unknown action' }, { status: 400 });
    
  } catch (error) {
    console.error('POST error:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

export const config = {
  runtime: 'edge',
};
