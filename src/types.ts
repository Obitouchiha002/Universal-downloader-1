export interface MediaFormat {
  id: string;
  label: string;
  ext: string;
  size: number | null;
  sizeText: string;
  note?: string;
  height?: number;
  bitrate?: number | null;
}

export interface VideoInfo {
  type?: 'media';
  title: string;
  thumbnail: string;
  duration: string | number;
  uploader?: string;
  source?: string;
  resolvedUrl: string;
  aiNote?: string;
  previewUrl?: string;
  images?: ImageOption[];
  video: MediaFormat[];
  audio: MediaFormat[];
}

export interface ImageOption {
  url: string;
  label: string;
  width: number;
  height: number;
}

export interface SearchResult {
  url: string;
  title: string;
  thumbnail: string;
  channel: string;
  duration: string;
}

export interface PlatformGroup {
  platform: string;
  kind: 'video' | 'audio';
  results: SearchResult[];
}

export interface SearchResponse {
  type: 'results';
  query: string;
  aiNote?: string;
  groups: PlatformGroup[];
}
