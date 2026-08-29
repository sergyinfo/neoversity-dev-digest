import { useEffect, useState } from 'react';

import { getPost } from '../api';

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

  if (error) return <p className="error">{error}</p>;
  if (!post) return <p className="loading">Loading…</p>;

  return (
    <article className="post">
      <h1 className="post__title">{post.title}</h1>

      <p className="post__byline">
        <span>{post.author.name}</span>
        {post.author.website ? (
          <a href={post.author.website} target="_blank" rel="noreferrer">
            website
          </a>
        ) : null}
      </p>

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
