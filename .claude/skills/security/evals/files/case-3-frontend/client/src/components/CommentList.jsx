import { useEffect, useState } from 'react';

import { getComments } from '../api';

export default function CommentList({ postId }) {
  const [comments, setComments] = useState([]);

  useEffect(() => {
    getComments(postId)
      .then(setComments)
      .catch(() => setComments([]));
  }, [postId]);

  return (
    <section className="comments">
      <h2>Comments</h2>
      {comments.map((comment) => (
        <article key={comment._id} className="comment">
          <p className="comment__author">{comment.authorName}</p>
          <p className="comment__body">{comment.body}</p>
        </article>
      ))}
    </section>
  );
}
