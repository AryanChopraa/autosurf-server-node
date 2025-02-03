import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';

const supabase = createClient(config.supabaseUrl!, config.supabaseKey!);

export interface ApiKey {
  id: string;
  user_id: string;
  api_key: string;
  created_at: string;
}

// Private helper functions
const encryptApiKey = async (apiKey: string): Promise<string> => {
  // In a production environment, implement proper encryption
  // For now, we'll just do a basic encoding
  return Buffer.from(apiKey).toString('base64');
};

const decryptApiKey = async (encryptedKey: string): Promise<string> => {
  // In a production environment, implement proper decryption
  return Buffer.from(encryptedKey, 'base64').toString('utf-8');
};

// API Key management functions
export const addApiKey = async (userId: string, apiKey: string): Promise<ApiKey> => {
  const encryptedKey = await encryptApiKey(apiKey);

  const { data, error } = await supabase
    .from('api_keys')
    .insert([
      {
        user_id: userId,
        api_key: encryptedKey
      }
    ])
    .select()
    .single();

  if (error) {
    throw new AppError('Failed to add API key', 500);
  }

  return data;
};

export const getApiKey = async (userId: string): Promise<string | null> => {
  const { data, error } = await supabase
    .from('api_keys')
    .select('api_key')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return null;
  }

  return decryptApiKey(data.api_key);
};

export const deleteApiKey = async (userId: string): Promise<void> => {
  const { error } = await supabase
    .from('api_keys')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw new AppError('Failed to delete API key', 500);
  }
};

export const updateApiKey = async (userId: string, newApiKey: string): Promise<ApiKey> => {
  const encryptedKey = await encryptApiKey(newApiKey);

  const { data, error } = await supabase
    .from('api_keys')
    .update({ api_key: encryptedKey })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new AppError('Failed to update API key', 500);
  }

  return data;
}; 