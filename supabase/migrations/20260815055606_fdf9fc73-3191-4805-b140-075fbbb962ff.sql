CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.generation_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image','video','music','flow')),
  provider text NOT NULL,
  model text NOT NULL,
  prompt text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  status_detail text,
  operation_name text,
  result jsonb,
  error_message text,
  actor text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX generation_jobs_user_created_idx ON public.generation_jobs (user_id, created_at DESC);

GRANT SELECT ON public.generation_jobs TO authenticated;
GRANT ALL ON public.generation_jobs TO service_role;
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own generation jobs"
  ON public.generation_jobs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE public.nexus_notebooks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  drive_folder_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nexus_notebooks_user_idx ON public.nexus_notebooks (user_id, created_at DESC);

GRANT SELECT ON public.nexus_notebooks TO authenticated;
GRANT ALL ON public.nexus_notebooks TO service_role;
ALTER TABLE public.nexus_notebooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own notebooks"
  ON public.nexus_notebooks FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE public.nexus_notebook_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notebook_id uuid NOT NULL REFERENCES public.nexus_notebooks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('drive_file','url','text')),
  title text NOT NULL,
  reference text,
  cached_text text,
  char_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nexus_notebook_sources_notebook_idx ON public.nexus_notebook_sources (notebook_id);

GRANT SELECT ON public.nexus_notebook_sources TO authenticated;
GRANT ALL ON public.nexus_notebook_sources TO service_role;
ALTER TABLE public.nexus_notebook_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own notebook sources"
  ON public.nexus_notebook_sources FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER generation_jobs_updated_at BEFORE UPDATE ON public.generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER nexus_notebooks_updated_at BEFORE UPDATE ON public.nexus_notebooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER nexus_notebook_sources_updated_at BEFORE UPDATE ON public.nexus_notebook_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();