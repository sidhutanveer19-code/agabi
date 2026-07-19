import { z } from "zod";

export const moleculeSchema = z.object({
  format: z.enum(["xyz", "sdf", "pdb", "mol2"]).default("xyz"),
  data: z.string(),
});
export type MoleculeData = z.infer<typeof moleculeSchema>;

export const moleculeSample: MoleculeData = {
  format: "xyz",
  data: `5
Methane
C  0.000  0.000  0.000
H  0.629  0.629  0.629
H -0.629 -0.629  0.629
H -0.629  0.629 -0.629
H  0.629 -0.629 -0.629`,
};
