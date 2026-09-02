export interface Finding {
  path: string;
  line: number;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface AgentSpec {
  name: string;
  systemPrompt: string;
  skills: string[];
}

export interface ReviewResult {
  verdict: 'approve' | 'comment' | 'request_changes';
  score: number;
  findings: Finding[];
}

export interface LLMProvider {
  complete(input: { system: string; user: string }): Promise<{
    text: string;
    findings: Finding[];
    confidence: number;
  }>;
}
