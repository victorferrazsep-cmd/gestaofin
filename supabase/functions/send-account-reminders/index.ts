import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type Account = {
  id: string;
  user_id: string;
  name: string;
  due: number;
  month: string;
};

type Task = {
  id: string;
  user_id: string;
  name: string;
  task_date: string;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  subscription: {
    endpoint: string;
    keys: { auth: string; p256dh: string };
  };
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cronSecret = Deno.env.get("PUSH_CRON_SECRET");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function saoPauloDate(): { iso: string; year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return { iso: `${values.year}-${values.month}-${values.day}`, year, month, day };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function dueDateFor(account: Account): string {
  const [year, month] = account.month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Math.max(account.due, 1), lastDay);
  return `${account.month}-${String(day).padStart(2, "0")}`;
}

function daysBetween(today: string, dueDate: string): number {
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const [dueYear, dueMonth, dueDay] = dueDate.split("-").map(Number);
  return (Date.UTC(dueYear, dueMonth - 1, dueDay) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86_400_000;
}

async function sendReminder(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  title: string,
  body: string,
  tag: string,
): Promise<boolean> {
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("id,user_id,endpoint,subscription")
    .eq("user_id", userId);
  if (error) throw error;

  let delivered = false;
  for (const row of (subscriptions || []) as PushSubscriptionRow[]) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({
        title,
        body,
        url: "https://victorferrazsep-cmd.github.io/gestaofin/",
        tag,
      }));
      delivered = true;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        const { error: deleteError } = await supabase.from("push_subscriptions").delete().eq("id", row.id);
        if (deleteError) console.error("Could not remove expired push subscription.", deleteError);
      } else {
        console.error("Push delivery failed.", { userId: row.user_id, statusCode, error });
      }
    }
  }
  return delivered;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const expectedAuthorization = `Bearer ${required(cronSecret, "PUSH_CRON_SECRET")}`;
    if (request.headers.get("authorization") !== expectedAuthorization) {
      return new Response("Unauthorized", { status: 401 });
    }

    webpush.setVapidDetails(
      required(vapidSubject, "VAPID_SUBJECT"),
      required(vapidPublicKey, "VAPID_PUBLIC_KEY"),
      required(vapidPrivateKey, "VAPID_PRIVATE_KEY"),
    );

    const supabase = createClient(
      required(supabaseUrl, "SUPABASE_URL"),
      required(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const today = saoPauloDate();
    const tomorrowDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    const tomorrow = `${tomorrowDate.getUTCFullYear()}-${String(tomorrowDate.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrowDate.getUTCDate()).padStart(2, "0")}`;
    const nextMonthDate = new Date(Date.UTC(today.year, today.month, 1));
    const firstMonth = monthKey(today.year, today.month);
    const lastMonth = monthKey(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1);
    const { data: accounts, error: accountError } = await supabase
      .from("accounts")
      .select("id,user_id,name,due,month")
      .eq("status", "Pendente")
      .gte("month", firstMonth)
      .lte("month", lastMonth);
    if (accountError) throw accountError;

    let sent = 0;
    for (const account of (accounts || []) as Account[]) {
      const dueDate = dueDateFor(account);
      const daysBefore = daysBetween(today.iso, dueDate);
      if (daysBefore !== 0 && daysBefore !== 1) continue;

      const { data: existingLog, error: logReadError } = await supabase
        .from("push_notification_log")
        .select("id")
        .eq("account_id", account.id)
        .eq("due_date", dueDate)
        .eq("days_before", daysBefore)
        .maybeSingle();
      if (logReadError) throw logReadError;
      if (existingLog) continue;

      const title = daysBefore === 0 ? "Conta vence hoje" : "Conta vence amanhã";
      const delivered = await sendReminder(
        supabase,
        account.user_id,
        title,
        `${account.name} vence ${daysBefore === 0 ? "hoje" : "amanhã"}. Abra o app para conferir.`,
        `account-${account.id}-${dueDate}-${daysBefore}`,
      );
      if (delivered) sent++;

      if (delivered) {
        const { error: logWriteError } = await supabase.from("push_notification_log").insert({
          account_id: account.id,
          due_date: dueDate,
          days_before: daysBefore,
        });
        if (logWriteError && logWriteError.code !== "23505") throw logWriteError;
      }
    }

    const { data: tasks, error: taskError } = await supabase
      .from("tasks")
      .select("id,user_id,name,task_date")
      .eq("done", false)
      .gte("task_date", today.iso)
      .lte("task_date", tomorrow);
    if (taskError) throw taskError;

    for (const task of (tasks || []) as Task[]) {
      const daysBefore = daysBetween(today.iso, task.task_date);
      if (daysBefore !== 0 && daysBefore !== 1) continue;

      const { data: existingLog, error: logReadError } = await supabase
        .from("task_push_notification_log")
        .select("id")
        .eq("task_id", task.id)
        .eq("task_date", task.task_date)
        .eq("days_before", daysBefore)
        .maybeSingle();
      if (logReadError) throw logReadError;
      if (existingLog) continue;

      const title = daysBefore === 0 ? "Tarefa programada para hoje" : "Tarefa programada para amanhã";
      const delivered = await sendReminder(
        supabase,
        task.user_id,
        title,
        `${task.name} está programada para ${daysBefore === 0 ? "hoje" : "amanhã"}. Abra o app para conferir.`,
        `task-${task.id}-${task.task_date}-${daysBefore}`,
      );
      if (!delivered) continue;
      sent++;

      const { error: logWriteError } = await supabase.from("task_push_notification_log").insert({
        task_id: task.id,
        task_date: task.task_date,
        days_before: daysBefore,
      });
      if (logWriteError && logWriteError.code !== "23505") throw logWriteError;
    }

    return Response.json({ ok: true, sent });
  } catch (error) {
    console.error("Account reminder job failed.", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
});
