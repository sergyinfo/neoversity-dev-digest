import { useEffect, useState } from 'react';

interface Pull {
  id: string;
  number: number;
  title: string;
  author: string;
  state: 'open' | 'merged' | 'closed';
}

export function PullList({ repoId }: { repoId: string }) {
  const [pulls, setPulls] = useState<Pull[]>([]);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE}/repos/${repoId}/pulls`)
      .then((r) => r.json())
      .then(setPulls)
      .catch(() => setPulls([]));
  }, [repoId]);

  return (
    <ul className="pull-list">
      {pulls.map((p) => (
        <li key={p.id}>
          <span className="pull-list__number">#{p.number}</span>
          <span className="pull-list__title">{p.title}</span>
          <span className="pull-list__author">{p.author}</span>
        </li>
      ))}
    </ul>
  );
}
