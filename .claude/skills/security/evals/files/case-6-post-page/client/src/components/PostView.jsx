import { useEffect, useMemo, useState } from 'react';

import { getPost } from '../api';
import { sanitizeRichText } from '../lib/sanitize';
import { safeUrl } from '../lib/url';

export default function PostView({ postId }) {
  const [post, setPost] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    getPost(postId)
      .then((data) => {
        if (!cancelled) setPost(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this post.');
      });

    return () => {
      cancelled = true;
    };
  }, [postId]);

  const safeBody = useMemo(
    () => (post ? sanitizeRichText(post.body) : ''),
    [post]
  );

  const excerpt = useMemo(
    () => safeBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
    [safeBody]
  );

  const website = useMemo(
    () => (post ? safeUrl(post.author.website) : null),
    [post]
  );

  if (error) return <p className="error">{error}</p>;
  if (!post) return <p className="loading">Loading…</p>;

  return (
    <article className="post">
      <h1 className="post__title">{post.title}</h1>
      <p className="post__excerpt">{excerpt}</p>

      <p className="post__byline">
        <span>{post.author.name}</span>
        {website ? (
          <a href={website} target="_blank" rel="noreferrer">
            website
          </a>
        ) : null}
      </p>

      {post.coverUrl ? (
        <img className="post__cover" src={post.coverUrl} alt="" loading="lazy" />
      ) : null}

      <div
        className="post__body"
        dangerouslySetInnerHTML={{ __html: post.body }}
      />

      <ul className="post__tags">
        {post.tags.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
    </article>
  );
}
