const CATBOX_UPLOAD_PATH = '/upload/catbox';
const MAX_CATBOX_UPLOAD_BYTES = 200 * 1024 * 1024;

function readErrorMessage(body, fallbackMessage) {
  const text = String(body || '').trim();

  if (!text) {
    return fallbackMessage;
  }

  return text;
}

export function isCatboxUploadConfigured() {
  return true;
}

export async function uploadFileToCatbox(file) {
  if (!file) {
    throw new Error('Choose a file before uploading.');
  }

  if (file.size > MAX_CATBOX_UPLOAD_BYTES) {
    throw new Error('Catbox allows files up to 200 MB. Pick a smaller file or paste a link instead.');
  }

  const formData = new FormData();
  formData.append('reqtype', 'fileupload');
  formData.append('fileToUpload', file, file.name || 'dispute-evidence');

  const response = await fetch(CATBOX_UPLOAD_PATH, {
    method: 'POST',
    body: formData
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(readErrorMessage(body, 'Catbox upload failed.'));
  }

  const uploadedUrl = String(body || '').trim();

  if (!/^https?:\/\//i.test(uploadedUrl)) {
    throw new Error(readErrorMessage(uploadedUrl, 'Catbox did not return a valid file link.'));
  }

  return {
    name: file.name || uploadedUrl.split('/').pop() || 'Uploaded file',
    url: uploadedUrl
  };
}
