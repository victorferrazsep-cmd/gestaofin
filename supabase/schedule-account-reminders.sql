select cron.unschedule(jobid)
from cron.job
where jobname = 'send-account-reminders-daily';

select cron.schedule(
  'send-account-reminders-daily',
  '0 12 * * *',
  $job$
    select net.http_post(
      url := 'https://bdmpudhhzngqkvoeagur.supabase.co/functions/v1/send-account-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'push_cron_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
