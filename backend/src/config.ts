import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  VOTER_JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  PUBLIC_VOTER_URL: z.string().url().default('http://localhost:5173'),
  ADMIN_EMAILS: z.string().default(''),
  AUTH_DEV_BYPASS: z
    .string()
    .default('false')
    .transform((value) => value === 'true')
}).refine((value) => value.SUPABASE_PUBLISHABLE_KEY || value.SUPABASE_ANON_KEY, {
  message: 'Informe SUPABASE_PUBLISHABLE_KEY.',
  path: ['SUPABASE_PUBLISHABLE_KEY']
});

export const config = schema.parse(process.env);
