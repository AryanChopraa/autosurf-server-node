import { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../middleware/errorHandler';
import { AgentRun } from '../types';

export const createAgentRun = async (userId: string, runObjective: string, supabase: SupabaseClient): Promise<string> => {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert([{
      user_id: userId,
      run_objective: runObjective,
      started_at: new Date().toISOString(),
      status: 'PENDING'
    }])
    .select('id')
    .single();

  if (error) {
    console.error('Error creating agent run:', error);
    throw new AppError('Failed to create agent run', 500);
  }

  return data.id;
};

export const getAllAgentRuns = async (userId: string, supabase: SupabaseClient) => {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    throw new AppError('Failed to fetch agent runs', 500);
  }

  return data || [];
};

export const getAgentRunById = async (agentRunId: string, supabase: SupabaseClient): Promise<AgentRun> => {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('id', agentRunId);

  if (error) {
    throw new AppError('Failed to fetch agent run', 500);
  }

  return data[0] as AgentRun;
};