import React, { useState, useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

// Icons fix for Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png'
});

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [activeTool, setActiveTool] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const drawnItems = useRef(new L.FeatureGroup());

  // Initialize map
  useEffect(() => {
    if (map.current) return;

    map.current = L.map(mapContainer.current).setView([40, -3], 6);

    // Base layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      maxNativeZoom: 18
    }).addTo(map.current);

    // Add drawing layer
    map.current.addLayer(drawnItems.current);

    return () => {
      if (map.current) map.current.remove();
      map.current = null;
    };
  }, []);

  // Handle drag events
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  // Handle drop
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // Handle file input change
  const handleFileUpload = (e) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  // Process files (unified handler)
  const handleFiles = async (uploadedFiles) => {
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    setUploading(true);
    setUploadProgress(0);
    const totalFiles = uploadedFiles.length;
    let processedFiles = 0;

    for (let file of uploadedFiles) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        // Replace with your backend URL
        const response = await fetch('http://localhost:5000/api/upload', {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          const newFile = {
            id: data.id,
            name: file.name,
            type: file.type,
            size: file.size,
            uploadDate: new Date().toISOString(),
            bounds: data.bounds || null
          };

          setFiles(prev => [newFile, ...prev]); // Add to top

          // Show success message
          setSuccessMessage(`✅ "${file.name}" uploaded!`);
          setTimeout(() => setSuccessMessage(''), 3000);

          // If geospatial data, add to map
          if (data.bounds) {
            const bounds = L.latLngBounds(
              [data.bounds[0], data.bounds[1]],
              [data.bounds[2], data.bounds[3]]
            );
            if (map.current) map.current.fitBounds(bounds);
          }

          processedFiles++;
          setUploadProgress((processedFiles / totalFiles) * 100);
        } else {
          alert('Failed to upload: ' + file.name);
        }
      } catch (error) {
        console.error('Upload failed:', error);
        alert('Error uploading ' + file.name);
      }
    }

    setUploading(false);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Tool: Draw Polygon
  const handleDrawPolygon = () => {
    if (activeTool === 'polygon') {
      setActiveTool(null);
      return;
    }

    setActiveTool('polygon');
    map.current.on('click', function drawMode(e) {
      // Simple drawing - click to add points, double-click to finish
      const latlng = e.latlng;
      L.circleMarker(latlng, { radius: 4, color: 'blue' }).addTo(drawnItems.current);
    });
  };

  // Tool: Measure Distance
  const handleMeasure = () => {
    if (activeTool === 'measure') {
      setActiveTool(null);
      return;
    }

    setActiveTool('measure');
    let firstPoint = null;
    let polyline = null;

    map.current.on('click', function measureMode(e) {
      if (!firstPoint) {
        firstPoint = e.latlng;
        L.circleMarker(firstPoint, { radius: 5, color: 'red', fillColor: 'red' }).addTo(drawnItems.current);
      } else {
        if (polyline) map.current.removeLayer(polyline);

        polyline = L.polyline([firstPoint, e.latlng], { color: 'red', weight: 2 }).addTo(drawnItems.current);

        const distance = map.current.distance(firstPoint, e.latlng);
        const distanceKm = (distance / 1000).toFixed(2);

        L.popup()
          .setLatLng(e.latlng)
          .setContent(`Distance: ${distanceKm} km`)
          .openOn(map.current);

        firstPoint = null;
      }
    });
  };

  // Download file
  const handleDownload = async (fileId) => {
    try {
      const response = await fetch(`http://localhost:5000/api/download/${fileId}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `file-${fileId}`;
      a.click();
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download file');
    }
  };

  // Delete file
  const handleDeleteFile = async (fileId) => {
    if (!window.confirm('Delete this file?')) return;

    try {
      await fetch(`http://localhost:5000/api/delete/${fileId}`, { method: 'DELETE' });
      setFiles(files.filter(f => f.id !== fileId));
      setActiveFile(null);
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  return (
    <div className="app">
      {/* Top Navigation Bar */}
      <nav className="navbar">
        <div className="navbar-left">
          <h1>🏗️ Construction Site Monitor</h1>
        </div>
        <div className="navbar-right">
          <span className="site-info">Drag & drop files anywhere to upload</span>
        </div>
      </nav>

      <div className="main-container">
        {/* Left Sidebar */}
        <div className={`sidebar`}>
          <div className="sidebar-content">
            {/* Upload Zone - BIG and OBVIOUS */}
            <div 
              ref={dropZoneRef}
              className={`upload-zone ${dragActive ? 'active' : ''} ${uploading ? 'uploading' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
            >
              {uploading ? (
                <div className="upload-loading">
                  <div className="spinner"></div>
                  <p>Uploading... {Math.round(uploadProgress)}%</p>
                  <div className="progress-bar">
                    <div className="progress" style={{ width: `${uploadProgress}%` }}></div>
                  </div>
                </div>
              ) : dragActive ? (
                <div className="upload-content">
                  <div className="upload-icon">📥</div>
                  <p className="upload-text">Drop files here!</p>
                </div>
              ) : (
                <div className="upload-content">
                  <div className="upload-icon">📤</div>
                  <p className="upload-text">Drag & drop files here</p>
                  <p className="upload-subtext">or click to browse</p>
                </div>
              )}
              <input 
                ref={fileInputRef}
                type="file" 
                multiple 
                onChange={handleFileUpload}
                disabled={uploading}
                accept=".tif,.tiff,.geotiff,.geojson,.shp,.shx,.dbf,.dwg,.dxf,.jpg,.jpeg,.png,.pdf"
                style={{ display: 'none' }}
              />
            </div>

            {/* Success Message */}
            {successMessage && (
              <div className="success-message">
                {successMessage}
              </div>
            )}

            <div className="sidebar-section">
              <h2>Tools</h2>
              <div className="tool-buttons">
                <button 
                  className={`tool-btn ${activeTool === 'polygon' ? 'active' : ''}`}
                  onClick={handleDrawPolygon}
                  title="Draw polygon"
                >
                  ✏️ Draw
                </button>
                <button 
                  className={`tool-btn ${activeTool === 'measure' ? 'active' : ''}`}
                  onClick={handleMeasure}
                  title="Measure distance"
                >
                  📏 Measure
                </button>
                <button className="tool-btn" title="Coming soon">
                  🎯 Track
                </button>
                <button className="tool-btn" title="Coming soon">
                  👁️ Compare
                </button>
              </div>
            </div>

            <div className="sidebar-section">
              <h2>📁 Files ({files.length})</h2>

              <div className="file-list">
                {files.length === 0 ? (
                  <div className="no-files">
                    <p>No files yet</p>
                    <p className="small">Upload to get started</p>
                  </div>
                ) : (
                  files.map(file => (
                    <div 
                      key={file.id} 
                      className={`file-item ${activeFile?.id === file.id ? 'active' : ''}`}
                      onClick={() => setActiveFile(file)}
                    >
                      <div className="file-header">
                        <span className="file-icon">📄</span>
                        <div className="file-info">
                          <span className="file-name">{file.name}</span>
                          <span className="file-size">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                        </div>
                      </div>
                      <div className="file-actions">
                        <button 
                          className="action-btn download"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(file.id);
                          }}
                          title="Download"
                        >
                          ⬇️
                        </button>
                        <button 
                          className="action-btn delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFile(file.id);
                          }}
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sidebar-section">
              <h2>📍 Map Layers</h2>
              <div className="layer-list">
                <label>
                  <input type="checkbox" defaultChecked /> Base Map
                </label>
                <label>
                  <input type="checkbox" defaultChecked /> Drawings
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Map Container */}
        <div className="map-wrapper">
          <div ref={mapContainer} className="map"></div>

          {/* Map Controls */}
          <div className="map-controls">
            <button className="control-btn" title="Zoom in">+</button>
            <button className="control-btn" title="Zoom out">−</button>
            <button className="control-btn" title="Center map">📍</button>
          </div>

          {/* File Details Panel (if file selected) */}
          {activeFile && (
            <div className="file-details">
              <button 
                className="close-btn"
                onClick={() => setActiveFile(null)}
              >
                ✕
              </button>
              <h3>{activeFile.name}</h3>
              <div className="details-content">
                <p><strong>Type:</strong> {activeFile.type}</p>
                <p><strong>Size:</strong> {(activeFile.size / 1024 / 1024).toFixed(2)} MB</p>
                <p><strong>Uploaded:</strong> {new Date(activeFile.uploadDate).toLocaleString()}</p>
                {activeFile.bounds && (
                  <p><strong>Bounds:</strong> {JSON.stringify(activeFile.bounds)}</p>
                )}
              </div>
              <button 
                className="detail-btn"
                onClick={() => handleDownload(activeFile.id)}
              >
                Download
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
