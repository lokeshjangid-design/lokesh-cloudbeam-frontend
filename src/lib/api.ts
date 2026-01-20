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
