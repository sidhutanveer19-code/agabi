/**
 * The interrupt commands a student can fire during (or after) teaching. Each one
 * creates a NEW explanation region — nothing is ever overwritten.
 */
export interface TeachCommand {
  id: string;
  label: string;
}

export const TEACH_COMMANDS: TeachCommand[] = [
  { id: "again", label: "Explain again" },
  { id: "simpler", label: "Simpler" },
  { id: "harder", label: "Harder" },
  { id: "example", label: "Another example" },
  { id: "visual", label: "Show visually" },
  { id: "why", label: "Why?" },
  { id: "how", label: "How?" },
  { id: "whatif", label: "What if?" },
  { id: "continue", label: "Continue" },
];
