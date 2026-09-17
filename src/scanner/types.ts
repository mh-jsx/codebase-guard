export type Severity = "critical" | "high" | "review";

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface Finding {
  readonly ruleId: string;
  readonly title: string;
  readonly description: string;
  readonly severity: Severity;
  readonly confidence: "high" | "medium" | "low";
  readonly score: number;
  readonly relativePath: string;
  readonly position: Position;
  readonly length: number;
  readonly evidence: string;
  readonly fingerprint: string;
}

export interface AnalyzeInput {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  readonly envPotentiallyUnignored?: boolean;
}

export interface AnalysisResult {
  readonly findings: readonly Finding[];
  readonly binary: boolean;
  readonly contentHash: string;
}

export interface SkippedFile {
  readonly relativePath: string;
  readonly reason: string;
}
