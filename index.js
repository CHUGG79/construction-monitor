/**
 * Construction Site Monitor - Cloudflare Workers Backend
 * 
 * Replaces Express.js server
 * Uses: Cloudflare Workers, R2 Storage, D1 Database, KV Cache
 * 
 * Deployment: wrangler deploy
 */

import { Router } from 'itty-router';
import { json, status } from 'itty-router-extras';

const router = Router();

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// Handle CORS preflight
router.options('*', () => new Response(null, { headers: corsHeaders }));

// ==================== HEALTH CHECK ====================
router.get('/api/health', () => {
  return json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Cloudflare Workers',
  }, { headers: corsHeaders });
});

// ==================== FILE UPLOAD ====================
router.post('/api/upload', async (req, context) => {
  try {
    const { UPLOADS, CACHE } = context.env;
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file) {
      return json({ error: 'No file uploaded' }, { status: 400, headers: corsHeaders });
    }

    // Validate file type
    const allowedTypes = [
      '.tif', '.tiff', '.geotiff',
      '.geojson', '.json',
      '.shp', '.shx', '.dbf',
      '.dwg', '.dxf',
      '.jpg', '.jpeg', '.png', '.webp', '.pdf'
    ];

    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowedTypes.includes(ext)) {
      return json(
        { error: `File type ${ext} not allowed` },
        { status: 400, headers: corsHeaders }
      );
    }

    // Check file size (500MB)
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      return json(
        { error: `File too large (max 500MB)` },
        { status: 400, headers: corsHeaders }
      );
    }

    // Generate file ID
    const fileId = crypto.randomUUID();
    const fileName = `${fileId}-${file.name}`;

    // Upload to R2
    const buffer = await file.arrayBuffer();
    await UPLOADS.put(fileName, buffer, {
      httpMetadata: {
        contentType: file.type,
      },
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Store metadata in KV cache
    const metadata = {
      id: fileId,
      originalName: file.name,
      fileName: fileName,
      size: file.size,
      type: file.type,
      uploadedAt: new Date().toISOString(),
      url: `/api/files/${fileId}`,
    };

    await CACHE.put(`file:${fileId}`, JSON.stringify(metadata), {
      expirationTtl: 30 * 24 * 60 * 60, // 30 days
    });

    // Log to console
    console.log(`✅ File uploaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

    return json(
      {
        id: fileId,
        filename: file.name,
        size: file.size,
        url: `/api/files/${fileId}`,
        downloadUrl: `/api/download/${fileId}`,
        uploadDate: new Date().toISOString(),
      },
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error('Upload error:', error);
    return json(
      { error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
});

// ==================== GET FILE LIST ====================
router.get('/api/files', async (req, context) => {
  try {
    const { UPLOADS } = context.env;

    // List all files from R2
    const files = await UPLOADS.list();
    const fileList = await Promise.all(
      files.objects.map(async (obj) => {
        const metadata = obj.customMetadata || {};
        return {
          id: obj.name.split('-')[0],
          name: metadata.originalName || obj.name,
          size: obj.size,
          uploadedAt: metadata.uploadedAt,
          url: `/api/files/${obj.name.split('-')[0]}`,
        };
      })
    );

    return json(fileList, { headers: corsHeaders });

  } catch (error) {
    console.error('List files error:', error);
    return json(
      { error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
});

// ==================== GET FILE METADATA ====================
router.get('/api/files/:id', async (req, context) => {
  try {
    const { CACHE } = context.env;
    const { id } = req.params;

    // Get from KV cache
    const metadataStr = await CACHE.get(`file:${id}`);
    if (!metadataStr) {
      return json(
        { error: 'File not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const metadata = JSON.parse(metadataStr);
    return json(metadata, { headers: corsHeaders });

  } catch (error) {
    console.error('Get file error:', error);
    return json(
      { error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
});

// ==================== DOWNLOAD FILE ====================
router.get('/api/download/:id', async (req, context) => {
  try {
    const { UPLOADS, CACHE } = context.env;
    const { id } = req.params;

    // Get metadata
    const metadataStr = await CACHE.get(`file:${id}`);
    if (!metadataStr) {
      return json(
        { error: 'File not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const metadata = JSON.parse(metadataStr);
    const fileName = metadata.fileName;

    // Get file from R2
    const file = await UPLOADS.get(fileName);
    if (!file) {
      return json(
        { error: 'File not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    // Return file with download headers
    return new Response(file.body, {
      headers: {
        'Content-Type': metadata.type,
        'Content-Disposition': `attachment; filename="${metadata.originalName}"`,
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error) {
    console.error('Download error:', error);
    return json(
      { error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
});

// ==================== DELETE FILE ====================
router.delete('/api/delete/:id', async (req, context) => {
  try {
    const { UPLOADS, CACHE } = context.env;
    const { id } = req.params;

    // Get metadata
    const metadataStr = await CACHE.get(`file:${id}`);
    if (!metadataStr) {
      return json(
        { error: 'File not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const metadata = JSON.parse(metadataStr);
    const fileName = metadata.fileName;

    // Delete from R2
    await UPLOADS.delete(fileName);

    // Delete from KV cache
    await CACHE.delete(`file:${id}`);

    console.log(`🗑️  File deleted: ${metadata.originalName}`);

    return json(
      { success: true, message: 'File deleted' },
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error('Delete error:', error);
    return json(
      { error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
});

// ==================== ANNOTATIONS/DRAWINGS ====================
router.post('/api/annotations', async (req, context) => {
  try {
    const { CACHE } = context.env;
    const body = await req.json();
    const { type, coordinates, properties, siteId } = body;

    if (!type || !coordinates) {
      return json(
        { error: 'Missing required fields' },
        { status: 400, headers: corsHeaders }
      );
    }

    const annotationId = crypto.randomUUID();
    const annotation = {
      id: annotationId,
      type,
      coordinates,
      properties: properties || {},
      siteId: siteId || 'default',
      createdAt: new Date().toISOString(),
    };

    // Store in KV
    await CACHE.put(
      `annotation:${annotationId}`,
      JSON.stringify(annotation),
      { expirationTtl: 30 * 24 * 60 * 60 }
    );

    console.log(`✏️  Annotation created: ${type}`);

    return json(annotation, { status: 201, headers: corsHeaders });

  } catch (error) {
    console.error('Annotation error:', error);
    return json(
      { error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
});

// ==================== GET ANNOTATIONS ====================
router.get('/api/annotations', async (req, context) => {
  try {
    const { CACHE } = context.env;
    const siteId = new URL(req.url).searchParams.get('siteId') || 'default';

    // Note: KV doesn't support efficient querying
    // For production, use D1 database instead
    // This is a simplified version

    return json([], { headers: corsHeaders });

  } catch (error) {
    console.error('Get annotations error:', error);
    return json(
      { error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
});

// ==================== DELETE ANNOTATION ====================
router.delete('/api/annotations/:id', async (req, context) => {
  try {
    const { CACHE } = context.env;
    const { id } = req.params;

    await CACHE.delete(`annotation:${id}`);

    console.log(`🗑️  Annotation deleted: ${id}`);

    return json(
      { success: true, message: 'Annotation deleted' },
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error('Delete annotation error:', error);
    return json(
      { error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
});

// ==================== 404 HANDLER ====================
router.all('*', () => {
  return json(
    { error: 'Not found' },
    { status: 404, headers: corsHeaders }
  );
});

// ==================== EXPORT ====================
export default {
  fetch: router.handle,
};
