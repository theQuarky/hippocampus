type FileType = 'pdf' | 'md' | 'txt' | 'audio' | 'image' | 'video' | 'url' | 'docx' | 'html' | string;

const TYPE_COLORS: Record<string, string> = {
  pdf:   'rgba(239,68,68,0.2)',
  md:    'rgba(59,130,246,0.2)',
  txt:   'rgba(59,130,246,0.2)',
  docx:  'rgba(59,130,246,0.2)',
  html:  'rgba(107,114,128,0.2)',
  url:   'rgba(107,114,128,0.2)',
  audio: 'rgba(168,85,247,0.2)',
  mp3:   'rgba(168,85,247,0.2)',
  wav:   'rgba(168,85,247,0.2)',
  image: 'rgba(34,197,94,0.2)',
  jpg:   'rgba(34,197,94,0.2)',
  png:   'rgba(34,197,94,0.2)',
  video: 'rgba(249,115,22,0.2)',
  mp4:   'rgba(249,115,22,0.2)',
};

const TYPE_TEXT: Record<string, string> = {
  pdf:   '#fca5a5',
  md:    '#93c5fd',
  txt:   '#93c5fd',
  docx:  '#93c5fd',
  html:  '#d1d5db',
  url:   '#d1d5db',
  audio: '#d8b4fe',
  mp3:   '#d8b4fe',
  wav:   '#d8b4fe',
  image: '#86efac',
  jpg:   '#86efac',
  png:   '#86efac',
  video: '#fdba74',
  mp4:   '#fdba74',
};

function normalizeType(source: string): string {
  const ext = source.split('.').pop()?.toLowerCase() ?? '';
  if (['mp3','wav','flac','m4a','ogg','opus'].includes(ext)) return 'audio';
  if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) return 'image';
  if (['mp4','mkv','avi','mov','m4v'].includes(ext)) return 'video';
  if (['md','markdown'].includes(ext)) return 'md';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (['html','htm'].includes(ext)) return 'html';
  if (ext === 'txt') return 'txt';
  if (source.startsWith('http')) return 'url';
  return ext || 'txt';
}

type TypeBadgeProps = {
  type: FileType;
  isSource?: boolean;
};

export function TypeBadge({ type, isSource = false }: TypeBadgeProps) {
  const normalized = isSource ? normalizeType(type) : type;
  const bg = TYPE_COLORS[normalized] ?? 'rgba(107,114,128,0.2)';
  const color = TYPE_TEXT[normalized] ?? '#d1d5db';
  return (
    <span className="badge" style={{ background: bg, color, fontFamily: 'monospace', fontSize: '0.72rem' }}>
      {normalized}
    </span>
  );
}
