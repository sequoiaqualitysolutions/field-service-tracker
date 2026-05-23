/* Google Maps type declarations (minimal subset used by RoutePlanner) */

declare namespace google.maps {
  class Map {
    constructor(element: HTMLElement, opts?: MapOptions);
    fitBounds(bounds: LatLngBounds, padding?: number | { top: number; right: number; bottom: number; left: number }): void;
    setCenter(latlng: LatLngLiteral): void;
    setZoom(zoom: number): void;
  }

  class Marker {
    constructor(opts?: MarkerOptions);
    setMap(map: Map | null): void;
    addListener(event: string, handler: () => void): void;
  }

  class Polyline {
    constructor(opts?: PolylineOptions);
    setMap(map: Map | null): void;
  }

  class InfoWindow {
    constructor(opts?: { content?: string });
    open(map: Map, marker: Marker): void;
  }

  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }

  class LatLngBounds {
    constructor();
    extend(latlng: LatLngLiteral | LatLng): void;
  }

  class Geocoder {
    geocode(
      request: { address: string },
    ): Promise<{ results: GeocoderResult[] }>;
  }

  class DistanceMatrixService {
    getDistanceMatrix(
      request: DistanceMatrixRequest,
      callback: (response: DistanceMatrixResponse | null, status: string) => void,
    ): void;
  }

  class DirectionsRenderer {
    setMap(map: Map | null): void;
  }

  interface MapOptions {
    zoom?: number;
    center?: LatLngLiteral;
    mapTypeId?: string;
    styles?: any[];
  }

  interface MarkerOptions {
    position?: LatLngLiteral;
    map?: Map;
    icon?: any;
    label?: { text: string; color?: string; fontWeight?: string; fontSize?: string } | string;
    title?: string;
    zIndex?: number;
  }

  interface PolylineOptions {
    path?: LatLngLiteral[];
    geodesic?: boolean;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
    map?: Map;
  }

  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  interface GeocoderResult {
    geometry: {
      location: LatLng;
    };
  }

  interface DistanceMatrixRequest {
    origins: LatLng[];
    destinations: LatLng[];
    travelMode: TravelMode;
    drivingOptions?: {
      departureTime: Date;
      trafficModel?: TrafficModel;
    };
    unitSystem?: UnitSystem;
  }

  interface DistanceMatrixResponse {
    rows: {
      elements: {
        status: string;
        distance: { value: number; text: string };
        duration: { value: number; text: string };
        duration_in_traffic?: { value: number; text: string };
      }[];
    }[];
  }

  enum TravelMode {
    DRIVING = 'DRIVING',
  }

  enum TrafficModel {
    BEST_GUESS = 'BEST_GUESS',
  }

  enum UnitSystem {
    METRIC = 0,
  }

  enum SymbolPath {
    CIRCLE = 0,
  }
}

interface Window {
  google?: {
    maps: typeof google.maps;
  };
}
