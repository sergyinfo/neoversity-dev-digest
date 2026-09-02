const API_URL = import.meta.env.VITE_API_URL;

async function get(pathname) {
  const res = await fetch(`${API_URL}${pathname}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

export function getPost(postId) {
  return get(`/api/posts/${encodeURIComponent(postId)}`);
}

export function getComments(postId) {
  return get(`/api/posts/${encodeURIComponent(postId)}/comments`);
}
