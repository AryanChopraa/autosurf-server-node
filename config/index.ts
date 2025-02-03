export const config = {
  port: process.env.PORT || 8080,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret'
}; 