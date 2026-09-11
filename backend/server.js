/**
 * Construction Site Monitor - Backend Server
 * 
 * Setup:
 * 1. npm init -y
 * 2. npm install express cors multer dotenv uuid sharp
 * 3. Create .env file with: PORT=5000
 * 4. node server.js
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== SETUP ====================

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'], // Your React dev server
  credentials: true
}));
app.use(express.json());

// File storage configuration
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    // Whitelist allowed file types
    const allowedExtensions = [
      '.tif', '.tiff', '.geotiff',
      '.geojson', '.json',
      '.shp', '.shx', '.dbf',
      '.dwg', '.dxf',
      '.jpg', '.jpeg', '.png', '.webp'
    ];
    
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = allowedExtensions.includes(ext);

    if (!allowed) {
      return cb(new Error(`File type ${ext} not allowed`));
    }
    cb(null, true);
  }
});

// ==================== SIMPLE IN-MEMORY DATABASE ====================
// For production, replace with PostgreSQL + PostGIS

const filesDatabase = new Map();
const annotationsDatabase = new Map();

// ==================== ROUTES ====================

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Upload file(s)
 * POST /api/upload
 * 
 * Request: multipart/form-data with 'file' field
 * Response: { id, filename, size, url, bounds }
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileId = path.parse(req.file.filename).name;
    const fileData = {
      id: fileId,
      originalName: req.file.originalname,
      filename: req.file.filename,
      filepath: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadDate: new Date().toISOString(),
      bounds: null, // TODO: Extract from GeoTIFF/geospatial file
      metadata: {}
    };

    // Extract geospatial information if available
    if (req.file.originalname.toLowerCase().endsWith('.tiff') || 
        req.file.originalname.toLowerCase().endsWith('.tif')) {
      // TODO: Use geotiff.js or GDAL to extract bounds
      // For now, add placeholder
      fileData.bounds = [[40, -3], [41, -2]]; // Example bounds
    }

    // Store in database
    filesDatabase.set(fileId, fileData);

    console.log(`✅ File uploaded: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)}MB)`);

    res.json({
      id: fileId,
      filename: req.file.originalname,
      size: req.file.size,
      url: `/api/files/${fileId}`,
      downloadUrl: `/api/download/${fileId}`,
      bounds: fileData.bounds,
      uploadDate: fileData.uploadDate
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get file metadata
 * GET /api/files/:id
 */
app.get('/api/files/:id', (req, res) => {
  const file = filesDatabase.get(req.params.id);
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.json({
    id: file.id,
    name: file.originalName,
    size: file.size,
    uploadDate: file.uploadDate,
    bounds: file.bounds,
    mimetype: file.mimetype
  });
});

/**
 * List all files
 * GET /api/files
 */
app.get('/api/files', (req, res) => {
  const files = Array.from(filesDatabase.values()).map(file => ({
    id: file.id,
    name: file.originalName,
    size: file.size,
    uploadDate: file.uploadDate,
    bounds: file.bounds,
    mimetype: file.mimetype
  }));

  res.json(files);
});

/**
 * Download file
 * GET /api/download/:id
 */
app.get('/api/download/:id', (req, res) => {
  const file = filesDatabase.get(req.params.id);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filePath = path.join(uploadDir, file.filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(filePath, file.originalName, (err) => {
    if (err) {
      console.error('Download error:', err);
    }
  });
});

/**
 * Delete file
 * DELETE /api/delete/:id
 */
app.delete('/api/delete/:id', (req, res) => {
  const file = filesDatabase.get(req.params.id);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    // Delete from disk
    const filePath = path.join(uploadDir, file.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database
    filesDatabase.delete(req.params.id);

    console.log(`🗑️  File deleted: ${file.originalName}`);

    res.json({ success: true, message: 'File deleted' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create annotation (drawing/measurement)
 * POST /api/annotations
 * 
 * Body: {
 *   type: 'polygon' | 'line' | 'point' | 'measurement',
 *   coordinates: [[lat, lng], ...],
 *   properties: { color, name, distance, area, ... },
 *   siteId: 'site123'
 * }
 */
app.post('/api/annotations', (req, res) => {
  try {
    const { type, coordinates, properties, siteId } = req.body;

    if (!type || !coordinates) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const annotationId = uuidv4();
    const annotation = {
      id: annotationId,
      type,
      coordinates,
      properties: properties || {},
      siteId: siteId || 'default',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    annotationsDatabase.set(annotationId, annotation);

    console.log(`✏️  Annotation created: ${type} (${annotationId})`);

    res.status(201).json(annotation);

  } catch (error) {
    console.error('Annotation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get annotations for a site
 * GET /api/annotations
 */
app.get('/api/annotations', (req, res) => {
  const siteId = req.query.siteId || 'default';
  
  const annotations = Array.from(annotationsDatabase.values()).filter(
    ann => ann.siteId === siteId
  );

  res.json(annotations);
});

/**
 * Delete annotation
 * DELETE /api/annotations/:id
 */
app.delete('/api/annotations/:id', (req, res) => {
  const annotation = annotationsDatabase.get(req.params.id);

  if (!annotation) {
    return res.status(404).json({ error: 'Annotation not found' });
  }

  annotationsDatabase.delete(req.params.id);
  console.log(`🗑️  Annotation deleted: ${req.params.id}`);

  res.json({ success: true, message: 'Annotation deleted' });
});

/**
 * Tile endpoint for geospatial files (TODO)
 * GET /api/tiles/:fileId/:z/:x/:y
 */
app.get('/api/tiles/:fileId/:z/:x/:y', (req, res) => {
  // TODO: Implement tile server for GeoTIFF files
  // This would use libraries like gdal-async or mapnik
  // to generate XYZ tiles on-the-fly
  res.status(501).json({ error: 'Tile server not yet implemented' });
});

// ==================== ERROR HANDLING ====================

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 500MB)' });
    }
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║  🏗️  Construction Site Monitor - Backend      ║
║  Server running on http://localhost:${PORT}      ║
║                                                ║
║  📁 Upload folder: ${uploadDir}
║  ✅ CORS enabled for: http://localhost:3000   ║
║                                                ║
║  API Endpoints:                                ║
║  POST   /api/upload         - Upload file     ║
║  GET    /api/files          - List files      ║
║  GET    /api/files/:id      - File metadata   ║
║  GET    /api/download/:id   - Download file   ║
║  DELETE /api/delete/:id     - Delete file     ║
║  POST   /api/annotations    - Create drawing  ║
║  GET    /api/annotations    - List drawings   ║
║  DELETE /api/annotations/:id - Delete drawing ║
║                                                ║
╚════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Server shutting down...');
  process.exit(0);
});
