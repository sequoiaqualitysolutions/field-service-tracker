import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

interface MapViewProps {
  startCoords: { lat: number; lng: number } | null;
  stopCoords?: { lat: number; lng: number } | null;
  height?: string;
}

export const MapView: React.FC<MapViewProps> = ({ startCoords, stopCoords, height = '200px' }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || (!startCoords && !stopCoords)) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const center = startCoords || stopCoords || { lat: 0, lng: 0 };
    const map = L.map(mapRef.current).setView([center.lat, center.lng], 15);
    mapInstanceRef.current = map;

    // Satellite tile layer
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
    ).addTo(map);

    // Label overlay
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19 }
    ).addTo(map);

    const greenIcon = L.divIcon({
      html: '<div style="background:#22c55e;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.4)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7], className: '',
    });

    const redIcon = L.divIcon({
      html: '<div style="background:#ef4444;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.4)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7], className: '',
    });

    const bounds: L.LatLngExpression[] = [];

    if (startCoords) {
      L.marker([startCoords.lat, startCoords.lng], { icon: greenIcon })
        .addTo(map)
        .bindPopup(`<b>START</b><br/>${startCoords.lat.toFixed(5)}, ${startCoords.lng.toFixed(5)}`);
      bounds.push([startCoords.lat, startCoords.lng]);
    }

    if (stopCoords) {
      L.marker([stopCoords.lat, stopCoords.lng], { icon: redIcon })
        .addTo(map)
        .bindPopup(`<b>STOP</b><br/>${stopCoords.lat.toFixed(5)}, ${stopCoords.lng.toFixed(5)}`);
      bounds.push([stopCoords.lat, stopCoords.lng]);
    }

    if (bounds.length === 2) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
    }

    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [startCoords, stopCoords]);

  if (!startCoords && !stopCoords) {
    return (
      <div className="bg-base-300 rounded-lg flex items-center justify-center text-base-content/40 text-sm" style={{ height }}>
        No GPS data available
      </div>
    );
  }

  return <div ref={mapRef} style={{ height }} className="rounded-lg" />;
};
