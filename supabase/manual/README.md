# Manual SQL

`deferred_functions.sql` installs `admin_save_question` and `admin_set_role`.
The tool used for the automated upload refuses any statement containing `delete from`, so these two
functions were not applied automatically. Run the file once in Supabase Dashboard -> SQL Editor.
(`setup_all.sql` and the migrations already contain them, so a fresh project set up that way needs nothing extra.)
