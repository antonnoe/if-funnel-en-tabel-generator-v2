import { put, list, del } from '@vercel/blob';

const DATA_FILE = 'funnel-data.json';
const BACKUP_PREFIX = 'backup-';
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

// Get blob URL by name
async function findBlob(name) {
  const { blobs } = await list();
  return blobs.find(b => b.pathname === name);
}

// Read JSON from blob
async function readData() {
  try {
    const blob = await findBlob(DATA_FILE);
    if (!blob) return { tiles: [], table: [] };
    
    const response = await fetch(blob.url);
    return await response.json();
  } catch (e) {
    console.error('Read error:', e);
    return { tiles: [], table: [] };
  }
}

// Write JSON to blob
async function writeData(data) {
  // Delete old file first (blob doesn't overwrite)
  const oldBlob = await findBlob(DATA_FILE);
  if (oldBlob) {
    await del(oldBlob.url);
  }
  
  await put(DATA_FILE, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json'
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  
  // Public embed data - no auth required
  if (action === 'embed') {
    const data = await readData();
    return Response.json(data);
  }
  
  // Admin actions require auth
  if (!checkAuth(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    if (action === 'backups') {
      const { blobs } = await list();
      const backups = blobs
        .filter(b => b.pathname.startsWith(BACKUP_PREFIX))
        .map(b => ({
          key: b.pathname,
          url: b.url,
          date: b.pathname.replace(BACKUP_PREFIX, '').replace('.json', '')
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
      
      return Response.json({ backups });
    }
    
    if (action === 'restore') {
      const key = searchParams.get('key');
      if (!key) {
        return Response.json({ error: 'Missing backup key' }, { status: 400 });
      }
      
      const blob = await findBlob(key);
      if (!blob) {
        return Response.json({ error: 'Backup not found' }, { status: 404 });
      }
      
      const response = await fetch(blob.url);
      const data = await response.json();
      return Response.json(data);
    }
    
    // Default: get current data
    const data = await readData();
    return Response.json(data);
    
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
    
    if (action === 'save' || action === 'import') {
      // Create backup before saving (only for 'save', not 'import')
      if (action === 'save') {
        const existing = await readData();
        if (existing && (existing.tiles?.length > 0 || existing.table?.length > 0)) {
          const backupName = BACKUP_PREFIX + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.json';
          await put(backupName, JSON.stringify(existing), {
            access: 'public',
            contentType: 'application/json'
          });
          
          // Clean old backups
          const { blobs } = await list();
          const backupBlobs = blobs
            .filter(b => b.pathname.startsWith(BACKUP_PREFIX))
            .sort((a, b) => b.pathname.localeCompare(a.pathname));
          
          if (backupBlobs.length > MAX_BACKUPS) {
            const toDelete = backupBlobs.slice(MAX_BACKUPS);
            for (const blob of toDelete) {
              await del(blob.url);
            }
          }
        }
      }
      
      // Save new data
      await writeData(data);
      return Response.json({ success: true, timestamp: new Date().toISOString() });
    }
    
    return Response.json({ error: 'Unknown action' }, { status: 400 });
    
  } catch (error) {
    console.error('POST error:', error);
    return Response.json({ error: 'Server error: ' + error.message }, { status: 500 });
  }
}
