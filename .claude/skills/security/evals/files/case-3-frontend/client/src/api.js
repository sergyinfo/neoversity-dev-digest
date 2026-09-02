const API_URL = import.meta.env.VITE_API_URL;

export async function getPost(postId) {
  const res = await fetch(`${API_URL}/api/posts/${encodeURIComponent(postId)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to load post');
  }
  return res.json();
}

export async function getComments(postId) {
  const res = await fetch(
    `${API_URL}/api/posts/${encodeURIComponent(postId)}/comments`,
    { credentials: 'include' }
  );
  if (!res.ok) {
    throw new Error('Failed to load comments');
  }
  return res.json();
}
