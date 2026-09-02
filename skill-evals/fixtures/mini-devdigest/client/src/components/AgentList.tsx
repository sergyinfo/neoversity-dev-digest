import { useEffect, useState } from 'react';

import type { AgentContract } from '@devdigest/shared';
import { api } from '../lib/api';

export function AgentList() {
  const [agents, setAgents] = useState<AgentContract[]>([]);

  useEffect(() => {
    api
      .get<AgentContract[]>('/agents')
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  return (
    <ul className="agent-list">
      {agents.map((a) => (
        <li key={a.id}>
          {a.name} · {a.model}
        </li>
      ))}
    </ul>
  );
}
