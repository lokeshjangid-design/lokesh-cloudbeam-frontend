const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:8787';

export type SessionFileMeta = {
  id: string;
  name: string;
  size: number;
  type: string;
};

export type SessionRecord = {
  id: string;
  pin: string;
  status: 'pending' | 'uploading' | 'ready' | 'completed' | 'expired';
  deviceName: string;
  expiresAt: number;
  files: SessionFileMeta[];
  requiresPassword: boolean;
};

export type CreateSessionPayload = {
  deviceName: string;
  expirySeconds: number;
  password?: string;
  tempSessionId: string;
};

export type UploadResponse = {
  tempSessionId: string;
  files: SessionFileMeta[];
};

async function handleJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).message)
        : 'Request failed';
    throw new Error(message);
  }
  return (data as T) ?? ({} as T);
}

export async function uploadFiles(
  files: File[],
  onProgress?: (progress: number) => void
): Promise<UploadResponse> {
  // If only one small file, use legacy method for simplicity
  if (files.length === 1 && files[0].size < 50 * 1024 * 1024) {
    return uploadFilesLegacy(files, onProgress);
  }

  // For multiple files or large files, use chunked upload
  return uploadFilesChunked(files, onProgress);
}

async function uploadFilesLegacy(
  files: File[],
  onProgress?: (progress: number) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });

    const xhr = new XMLHttpRequest();
    
    // Progress tracking
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress?.(progress);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (error) {
          reject(new Error('Invalid response from server'));
        }
      } else {
        try {
          const errorData = JSON.parse(xhr.responseText);
          reject(new Error(errorData.message || 'Upload failed'));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.open('POST', `${API_BASE_URL}/api/upload`);
    xhr.send(formData);
  });
}

async function uploadFilesChunked(
  files: File[],
  onProgress?: (progress: number) => void
): Promise<UploadResponse> {
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
  const CONCURRENT_CHUNKS = 3; // Upload 3 chunks at a time
  let sessionId: string | null = null;
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let uploadedBytes = 0;

  for (const file of files) {
    // Initialize chunked upload
    const initResponse = await fetch(`${API_BASE_URL}/api/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        sessionId: sessionId || undefined,
      }),
    });

    if (!initResponse.ok) {
      throw new Error('Failed to initialize upload');
    }

    const { uploadId, sessionId: newSessionId, totalChunks } = await initResponse.json();
    sessionId = newSessionId;

    // Create chunks
    const chunks: Array<{ index: number; data: Blob }> = [];
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      chunks.push({ index: i, data: chunk });
    }

    // Upload chunks with concurrency control
    const uploadChunk = async (chunk: { index: number; data: Blob }) => {
      const response = await fetch(`${API_BASE_URL}/api/upload/chunk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Id': uploadId,
          'X-Chunk-Index': chunk.index.toString(),
        },
        body: chunk.data,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload chunk ${chunk.index}`);
      }

      uploadedBytes += chunk.data.size;
      const progress = Math.round((uploadedBytes / totalBytes) * 100);
      onProgress?.(progress);

      return response.json();
    };

    // Upload chunks in batches
    for (let i = 0; i < chunks.length; i += CONCURRENT_CHUNKS) {
      const batch = chunks.slice(i, i + CONCURRENT_CHUNKS);
      await Promise.all(batch.map(uploadChunk));
    }

    // Complete upload
    const completeResponse = await fetch(`${API_BASE_URL}/api/upload/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });

    if (!completeResponse.ok) {
      throw new Error('Failed to complete upload');
    }
  }

  return {
    tempSessionId: sessionId!,
    files: files.map((file, index) => ({
      id: `${file.name}-${file.size}-${index}`,
      name: file.name,
      size: file.size,
      type: file.type,
    })),
  };
}

export async function createSession(payload: CreateSessionPayload): Promise<SessionRecord> {
  const response = await fetch(`${API_BASE_URL}/api/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return handleJson<SessionRecord>(response);
}

export async function lookupSessionByPin(pin: string): Promise<SessionRecord> {
  const response = await fetch(`${API_BASE_URL}/api/session/by-pin/${pin}`);
  return handleJson<SessionRecord>(response);
}
