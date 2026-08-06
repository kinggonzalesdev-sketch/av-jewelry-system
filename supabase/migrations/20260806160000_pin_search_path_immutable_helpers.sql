-- Security hardening: pin an empty search_path on three pure IMMUTABLE helpers so
-- they are immune to search_path manipulation (Supabase advisor
-- function_search_path_mutable). Each uses only built-in operators/functions and
-- touches no tables, so an empty search_path changes nothing about their behaviour.
alter function public.layaway_letter_for_name(text) set search_path to '';
alter function app_private.grams_from_code(text) set search_path to '';
alter function app_private.layaway_interest_per_gram() set search_path to '';
