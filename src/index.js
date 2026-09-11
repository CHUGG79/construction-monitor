/**
 * Construction Site Monitor - Cloudflare Workers
 * Simplified version without dependencies
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (path === '/api/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Cloudflare Workers',
        message: 'Construction Site Monitor API is running!'
      }), { headers: corsHeaders });
    }

    // Upload endpoint
    if (path === '/api/upload' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
          return new Response(JSON.stringify({
            error: 'No file uploaded'
          }), { status: 400, headers: corsHeaders });
        }

        const fileId = crypto.randomUUID();
        const fileName = `${fileId}-${file.name}`;

        // Upload to R2
        const bucket = env.UPLOADS;
        const buffer = await file.arrayBuffer();
        
        await bucket.put(fileName, buffer, {
          httpMetadata: {
            contentType: file.type,
          },
          customMetadata: {
            originalName: file.name,
            uploadedAt: new Date().toISOString(),
          },
        });

        return new Response(JSON.stringify({
          id: fileId,
          filename: file.name,
          size: file.size,
          uploadDate: new Date().toISOString(),
          message: 'File uploaded successfully to R2'
        }), { headers: corsHeaders });

      } catch (error) {
        return new Response(JSON.stringify({
          error: error.message
        }), { status: 500, headers: corsHeaders });
      }
    }

    // Get files list
    if (path === '/api/files' && request.method === 'GET') {
      try {
        const bucket = env.UPLOADS;
        const files = await bucket.list();

        const fileList = files.objects.map(obj => ({
          id: obj.name.split('-')[0],
          name: obj.customMetadata?.originalName || obj.name,
          size: obj.size,
          uploadedAt: obj.customMetadata?.uploadedAt,
        }));

        return new Response(JSON.stringify(fileList), { headers: corsHeaders });

      } catch (error) {
        return new Response(JSON.stringify({
          error: error.message
        }), { status: 500, headers: corsHeaders });
      }
    }

    // 404 - Not found
    return new Response(JSON.stringify({
      error: 'Not found',
      path: path
    }), { status: 404, headers: corsHeaders });
  }
};