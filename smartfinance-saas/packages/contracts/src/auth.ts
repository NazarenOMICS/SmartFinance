import { z } from "zod";

export const authContextSchema = z.object({
  userId: z.string(),
  authMode: z.enum(["development", "clerk"]),
});

export type AuthContext = z.infer<typeof authContextSchema>;
