// ============================================================================
//  Where the two servers live, and the defaults the simulator starts with.
// ============================================================================
//  Only NEXT_PUBLIC_ variables reach the browser. These are plain URLs, so
//  exposing them is fine - a secret would never be put here.
// ============================================================================

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const MESH_URL = process.env.NEXT_PUBLIC_MESH_URL || 'http://localhost:5000';
export const MESH_WS = process.env.NEXT_PUBLIC_MESH_WS || 'ws://localhost:5000';

/** Yarkon Park - the area the seed script populates. */
export const DEFAULT_CENTER = { lat: 32.1010, lng: 34.8090 };
export const DEFAULT_ZOOM = 14;

/** Simulator defaults (Requirement #10 - the Radius parameter). */
export const DEFAULT_RADIUS_M = 1500;
export const DEFAULT_SAMPLE_SIZE = 8;

/** One place for the channel vocabulary, so colours and labels never disagree. */
export const CHANNELS = {
  LORA: { label: 'רשת LoRa', color: '#7c3aed', badge: 'bg-lora-light text-lora' },
  SMS: { label: 'סלולרי / SMS', color: '#0891b2', badge: 'bg-cell-light text-cell' },
  NONE: { label: 'אין קשר', color: '#64748b', badge: 'bg-offline-light text-offline' },
};
