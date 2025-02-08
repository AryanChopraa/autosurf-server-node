import { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../middleware/errorHandler';
import { Automation,ScriptCommand} from '../types';

export const createAutomation = async (userId: string, automationName: string, commands: ScriptCommand[], runObjective: string, supabase: SupabaseClient): Promise<string> => {
  const { data, error } = await supabase
    .from('saved_automations')
    .insert([{
      user_id: userId,
      automation_name: automationName,
      steps: commands,
      objective: runObjective,
      created_at: new Date().toISOString(),
    }])
    .select('id')
    .single();

  if (error) {
    console.error('Error creating automation', error);
    throw new AppError('Failed to create automation', 500);
  }

  return data.id;
};

export const getAllAutomations = async (userId: string, supabase: SupabaseClient): Promise<Automation[]> => {
  const { data, error } = await supabase
    .from('saved_automations')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    throw new AppError('Failed to fetch automations', 500);
  }

  return data || [];
};

export const getAutomationById = async (automationId: string, supabase: SupabaseClient): Promise<Automation> => {
  const { data, error } = await supabase
    .from('saved_automations')
    .select('*')
    .eq('id', automationId);

  if (error) {
    throw new AppError('Failed to fetch automation', 500);
  }

  return data[0] as Automation;
};

export const updateAutomation = async (automation: Automation, supabase: SupabaseClient): Promise<void> => {
  console.log(automation);
  const { error } = await supabase
    .from('saved_automations')
    .update(automation)
    .eq('id', automation.id);

  console.log(error);

  if (error) {
    throw new AppError('Failed to update automation', 500);
  }
};

export const deleteAutomation = async (automationId: string, supabase: SupabaseClient): Promise<void> => {
    const { error } = await supabase
        .from('saved_automations')
        .delete()
        .eq('id', automationId);

    if (error) {
        console.error('Error deleting automation:', error);
        throw new AppError('Failed to delete automation', 500);
    }
};